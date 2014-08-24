import urllib2, re, sys, json, collections, datetime, time, os

regex_authors = re.compile(r'GLatLng[(]([-]?\d+[.]\d+)[,]([-]?\d+[.]\d+).+author/([^/]+)')
regex_author_entries = re.compile(r'../../([^/]+)/\?action=preview\&uid=(\d+)')
regex_comp_entries = re.compile(r"<a href='\?action=preview&uid=([0-9]+)'><img src='([^']*)'><div class='title'><i>(.*?)</i></div>(.*?)</a></div>")
regex_author = re.compile(r'../author/([^/]+)')
regex_author_name = re.compile(r'<h2 class="pagetitle">About ([^(<]+)')
regex_commenter = re.compile(r'"?action=preview&uid=(\d+)">.*</a> says ...</strong></div><div><small>([^<]+)')
regex_target = re.compile(r'href="([^"]+)" target=\'_blank\'>([^<]+)</a>')

class DotDict(collections.defaultdict):
    __getattr__ = dict.__getitem__
    __setattr__ = dict.__setitem__
    __delattr__ = dict.__delitem__
    def __init__(self, *args):
        collections.defaultdict.__init__(self, None, *args)

comps = collections.defaultdict(lambda: len(comps))

authors_by_username = {}
authors_by_uid = {}

data_filename = 'data.json'

def save_data():
    print "saving to", data_filename
    with open(data_filename, 'w') as f:
        json.dump({
                "competitions": comps,
                "authors": authors_by_uid.values(),
            }, f, indent=2)
        
def load_data():
    if not os.path.exists(data_filename):
        print "(first run!)"
        return
    print "loading from", data_filename
    with open(data_filename, 'r') as f:
        data = json.load(f, object_hook=DotDict)
        for comp, id in data.competitions.items():
            comps[comp] = id
        for author in data.authors:
            if "commenters" in author:
                author.commenters = {int(i): c for i, c in author.commenters.items()}
            else:
                author.commenters = {}
            authors_by_username[author.username] = author
            authors_by_uid[author.uid] = author

def update_from_world_map():
    print "=== UPDATING FROM WORLD MAP ==="
    new = False
    response = urllib2.urlopen('http://www.ludumdare.com/compo/world-map/').read()
    for lat, lng, username in regex_authors.findall(response):
        author = authors_by_username.get(username)
        if not author:
            try:
                response = urllib2.urlopen('http://www.ludumdare.com/compo/author/%s/' % username).read()
            except urllib2.HTTPError as e:
                print >> sys.stderr, 'ERROR: cannot get author page for', username, e
                continue
            entries = regex_author_entries.findall(response)
            if not entries:
                print >> sys.stderr, 'ERROR: cannot determine uid for', username
                continue
            uid = list(set(u for c, u in entries))
            assert len(uid) == 1, uid
            uid = uid[0]
            name = regex_author_name.findall(response)
            if len(name) != 1:
                print >> sys.stderr, 'ERROR: cannot determine name for', username, uid, name
                continue
            name = name[0].strip()
            new = True
            author = DotDict()
            author.name, author.username, author.uid = name, username, uid
            author.comps = [comps[c] for c, u in entries]
            author.commenters = {}
            authors_by_username[username] = author
            authors_by_uid[uid] = author
        author.position = (float(lat), float(lng))
    return new
            
def update_from_comp_listings(ludum_dare):
    print "=== UPDATING FROM COMP LISTINGS", ludum_dare, "==="
    ludum_dare_id = comps[ludum_dare]
    def date_parse(d):
        # "Aug 21, 2013 @ 1:48am"
        months = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
        month, _, d = d.partition(" ")
        day, _, d = d.partition(", ")
        year, _, d = d.partition(" @")
        hour, _, d = d.partition(":")
        minute = d[:2]
        d = datetime.datetime(int(year), months.index(month), int(day), int(hour), int(minute))
        return int((d - datetime.datetime(1970, 1, 1)).total_seconds())
    new = False
    page, start = 0, 0
    while True:
        page += 1
        try:
            url = 'http://www.ludumdare.com/compo/%s/?action=preview&etype=&start=%d' % (ludum_dare, start)
            response = urllib2.urlopen(url).read()
            print 'fetched', url
        except urllib2.HTTPError as e:
            if e.code == 404:
                break
            raise
        response = regex_comp_entries.findall(response)
        if not response:
            break
        for uid, img, title, name in response:
            start += 1
            try:
                url = 'http://www.ludumdare.com/compo/%s/?action=preview&uid=%s' % (ludum_dare, uid)
                response = urllib2.urlopen(url).read()
            except urllib2.HTTPError as e:
                print >> sys.stderr, 'ERROR: cannot get entry page for', username, uid, ludum_dare, e
                continue
            username = list(set(regex_author.findall(response)))
            if not username:
                print >> sys.stderr, "ERROR: cannot find", name, uid, "username"
                continue
            if len(username) != 1:
                print >> sys.stderr, "ERROR: ambiguous author", name, uid, username
                continue
            username = username[0]
            
            try:
                targets = response[response.index('<div class="entry">'):]
                targets = targets[targets.index('</h3>'):]
                targets = targets[:targets.index("</p><p>")]
                targets = tuple((path, intern(target)) for path, target in regex_target.findall(targets))
            except Exception as e:
                print "ERROR computing target", url, e
                targets = None
            
            commenters = [[i, date_parse(d)] for i, d in regex_commenter.findall(response)]
            if uid not in authors_by_uid:
                entries = [ludum_dare_id]
                try:
                    response = urllib2.urlopen('http://www.ludumdare.com/compo/author/%s/' % username).read()
                    entries = regex_author_entries.findall(response)
                    if not entries:
                        print >> sys.stderr, 'WARNING:', username, uid, 'has no entries!?!'
                    elif not all(u == uid for c, u in entries):
                        print >> sys.stderr, 'ERROR:', username, uid, 'has mismatching uid', entries
                        continue
                    else:
                        entries = [comps[c] for c, u in entries]
                        if ludum_dare_id not in entries:
                            print >> sys.stderr, 'ERROR:', username, uid, 'has not entered', ludum_dare
                            entries.append(ludum_dare_id)
                except urllib2.HTTPError as e:
                    print >> sys.stderr, 'WARNING: cannot get author page for', username, uid, e
                author = DotDict()
                author.name, author.username, author.uid = name.strip(), username, uid
                author.commenters = {}
                new = True
                author.comps = entries
                authors_by_username[username] = author
                authors_by_uid[uid] = author
            else:
                author = authors_by_uid[uid]
                if author.get("position"):
                    print author.username,  author.uid, 'is at', author.position
            if ludum_dare_id not in author.commenters or author.commenters[ludum_dare_id] != commenters:
                author.commenters[ludum_dare_id] = commenters
                new = True
            if author.get("targets") != targets:
                author.targets = targets
                new = True
    return new
    
def tick(ludum_dare):
    save = []
    #save.append(update_from_world_map())
    save.append(update_from_comp_listings(ludum_dare))
    if any(save):
        save_data()
        
        
if __name__ == "__main__":
    load_data()
    tick('ludum-dare-27-warmup')
