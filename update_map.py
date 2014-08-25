import urllib2, re, sys, json, collections, datetime, time, os, traceback

regex_authors = re.compile(r'GLatLng[(]([-]?\d+[.]\d+)[,]([-]?\d+[.]\d+).+author/([^/]+)')
regex_author_entries = re.compile(r'\.\./\.\./([^/]+)/\?action=preview\&uid=(\d+)')
regex_comp_entries = re.compile(r"<a href='\?action=preview&uid=([0-9]+)'><img src='([^']*)'><div class='title'><i>(.*?)</i></div>(.*?)</a></div>")
regex_author = re.compile(r'\.\./author/([^/]+)')
regex_author_name = re.compile(r'<h2 class="pagetitle">About ([^(<]+)')
regex_commenter = re.compile(r'"?action=preview&uid=(\d+)">.*</a> says ...</strong></div><div><small>([^<]+)')
regex_target = re.compile(r'href="([^"]+)" target=\'_blank\'>([^<]+)</a>')

import Queue, threading, functools
queue = Queue.Queue()
def process():
    while True:
        job = queue.get()
        try:
            job()
        except:
            traceback.print_exc()
        queue.task_done()  
pool = [threading.Thread(target=process) for _ in range(10)]
for thread in pool:
    thread.setDaemon(True)
    thread.start()

class DotDict(collections.defaultdict):
    __getattr__ = dict.__getitem__
    __setattr__ = dict.__setitem__
    __delattr__ = dict.__delitem__
    def __init__(self, *args):
        collections.defaultdict.__init__(self, None, *args)

comps = collections.defaultdict(lambda: len(comps))
seq_lock = threading.RLock()
seq, comments_count = 0, 0

debug_jobs = False

authors_by_username = {}
authors_by_uid = {}

data_filename = 'data.json'

def save_data():
    global seq
    print "saving to", data_filename
    with open(data_filename, 'w') as f, seq_lock:
        json.dump({
                "competitions": comps,
                "seq": seq,
                "authors": authors_by_uid.values(),
            }, f, indent=2)
        
def load_data(ludum_dare):
    global seq, comments_count
    if not os.path.exists(data_filename):
        print "(first run!)"
        return
    with open(data_filename, 'r') as f, seq_lock:
        data = json.load(f, object_hook=DotDict)
        seq = data.seq
        comments_count = 0
        for comp, id in data.competitions.items():
            comps[comp] = id
        ludum_dare_id = str(comps[ludum_dare]) # for conversion of old style
        for author in data.authors:
            if "commenters" in author:
                if isinstance(author.commenters, dict): # old style
                    author.commenters = author.commenters.get(ludum_dare_id,[])
                comments_count += len(author.commenters)
                if not author.commenters:
                    del author["commenters"]
            authors_by_username[author.username] = author
            authors_by_uid[author.uid] = author
    print "loaded",ludum_dare,"from", data_filename, len(authors_by_uid), seq, comments_count

def load_author_page(lat, lng, username):
    global seq
    author = authors_by_username.get(username)
    if not author:
        try:
            url = 'http://www.ludumdare.com/compo/author/%s/' % username
            if debug_jobs:
                print "\tfetching", url
            response = urllib2.urlopen(url).read()
        except urllib2.HTTPError as e:
            if debug_jobs:
                print >> sys.stderr, 'ERROR: cannot get author page for', username, e
            return
        entries = regex_author_entries.findall(response)
        if not entries:
            if debug_jobs:
                print >> sys.stderr, 'ERROR: cannot determine uid for', username
            return
        uid = list(set(u for c, u in entries))
        assert len(uid) == 1, uid
        uid = uid[0]
        name = regex_author_name.findall(response)
        if len(name) != 1:
            print >> sys.stderr, 'ERROR: cannot determine name for', username, uid, name
            return
        name = name[0].strip()
        author = DotDict()
        author.name, author.username, author.uid = name, username, uid
        author.comps = [comps[c] for c, u in entries]
        author.commenters = {}
        author.position = [float(lat), float(lng)]
        with seq_lock:
            seq += 1
            author.seq = seq
            authors_by_username[username] = author
            authors_by_uid[uid] = author
    else:
        position = [float(lat), float(lng)]
        if author.get("position") != position:
            with seq_lock:
                seq += 1
                author.seq = seq
                author.position = position

def update_from_world_map():
    if debug_jobs:
        print "=== UPDATING FROM WORLD MAP ==="
    response = urllib2.urlopen('http://www.ludumdare.com/compo/world-map/').read()
    for lat, lng, username in regex_authors.findall(response):
        queue.put(functools.partial(load_author_page, lat, lng, username))
    queue.join()
        
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
    
def load_user_page(ludum_dare, uid, img, title, name):
    global seq, comments_count
    ludum_dare_id = comps[ludum_dare]
    try:
        url = 'http://www.ludumdare.com/compo/%s/?action=preview&uid=%s' % (ludum_dare, uid)
        if debug_jobs:
            print "\tfetching", url
        response = urllib2.urlopen(url).read()
    except urllib2.HTTPError as e:
        if debug_jobs:
            print >> sys.stderr, 'ERROR: cannot get entry page for', username, uid, ludum_dare, e
        return
    username = list(set(regex_author.findall(response)))
    if not username:
        print >> sys.stderr, "ERROR: cannot find", name, uid, "username"
        return
    if len(username) != 1:
        print >> sys.stderr, "ERROR: ambiguous author", name, uid, username
        return
    username = username[0]
    
    try:
        targets = response[response.index('<div class="entry">'):]
        targets = targets[targets.index('</h3>'):]
        targets = targets[:targets.index("</p><p>")]
        targets = [[path, intern(target)] for path, target in regex_target.findall(targets)]
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
                if debug_jobs:
                    print >> sys.stderr, 'WARNING:', username, uid, 'has no entries!?!'
            elif not all(u == uid for c, u in entries):
                print >> sys.stderr, 'ERROR:', username, uid, 'has mismatching uid', entries
                return
            else:
                entries = [comps[c] for c, u in entries]
                if ludum_dare_id not in entries:
                    print >> sys.stderr, 'ERROR:', username, uid, 'has not entered', ludum_dare
                    entries.append(ludum_dare_id)
        except urllib2.HTTPError as e:
            print >> sys.stderr, 'WARNING: cannot get author page for', username, uid, e
        author = DotDict()
        author.name, author.username, author.uid = name.strip(), username, uid
        author.comps = entries
        author.img = img
        new = True
        print "new user", uid, username, name
        with seq_lock:
            seq += 1
            author.seq = seq
            authors_by_username[username] = author
            authors_by_uid[uid] = author
    else:
        new = False
        author = authors_by_uid[uid]
        if debug_jobs and author.get("position"):
            print author.username,  author.uid, 'is at', author.position
    changes = (author.get("commenters", []) != commenters,
        author.get("targets") != targets,
        author.get("img") != img)
    if any(changes):
        with seq_lock:
            if not new:
                if debug_jobs:
                    print "updating", uid, username, name, changes
                seq += 1
                author.seq = seq
            if commenters:
                comments_count += len(commenters) - len(author.get("commenters",""))
                author.commenters = commenters
            author.targets = targets
            author.img = img
            
def update_from_comp_listings(ludum_dare):
    if debug_jobs:
        print "=== UPDATING FROM COMP LISTINGS", ludum_dare, "==="
    page, start = 0, 0
    while True:
        page += 1
        try:
            url = 'http://www.ludumdare.com/compo/%s/?action=preview&etype=&start=%d' % (ludum_dare, start)
            response = urllib2.urlopen(url).read()
            if debug_jobs:
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
            queue.put(functools.partial(load_user_page, ludum_dare, uid, img, title, name))
        queue.join()
    
def tick(ludum_dare):
    global seq
    prev_seq, prev_comments = seq, comments_count
    start_time = time.time()
    update_from_world_map()
    update_from_comp_listings(ludum_dare)
    if prev_seq != seq:
        save_data()
    elapsed = (time.time()-start_time)
    print "tick %d+%d, %d+%d took %dm" % (len(authors_by_uid), seq-prev_seq, comments_count, comments_count-prev_comments, int(elapsed/60))
    ludum_dare_id = comps[ludum_dare]
    authors_with_position = set(uid for uid,author in authors_by_uid.iteritems() if "position" in author and ludum_dare_id in author.comps)
    comments_by_positioners = 0
    for uid in authors_with_position:
        author = authors_by_uid[uid]
        if "commenters" in author:
            comments_by_positioners += len(authors_with_position & set(uid for uid, _ in author.commenters))
    with open("stats.csv","a") as f:
        f.write("%d,%d,%d,%d,%d,%d,%d\n" % (int(start_time),int(elapsed),len(authors_by_uid),
            seq,comments_count,len(authors_with_position),comments_by_positioners))
        
if __name__ == "__main__":
    ludum_dare = 'ludum-dare-27-warmup'
    load_data(ludum_dare)
    tick(ludum_dare)
