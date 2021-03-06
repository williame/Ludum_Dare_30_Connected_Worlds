import random, json, time, traceback, collections, logging

import tornado.websocket
from tornado.options import options

options.define("interval",default=60*10,type=int)

import update_map, geoloc

ludum_dare = 'ludum-dare-30'

class LD30WebSocket(tornado.websocket.WebSocketHandler):
    closed = False
    def allow_draft76():
    	    print "draft76 rejected"
    	    return False
    def open(self):
        self.origin = self.request.headers.get("origin","")
        self.userAgent = self.request.headers.get("user-agent")
        logging.info("connection %s %s %s", geoloc.pretty_ip(self.request.remote_ip), self.origin, self.userAgent)
        if not any(map(self.origin.startswith, (options.origin, "http://31.192.226.244:",
            "http://localhost:", "http://williame.github.io"))):
            logging.warning("kicking out bad origin: %s" % self.origin)
            self.write_message('{"chat":[{"Will":"if you fork the code, you need to run your own server!"}]}')
            self.close()
    def on_message(self,message):
        self.lastMessage = time.time()
        try:
            message = json.loads(message)
            assert isinstance(message,dict)
            ludum_dare_id = update_map.comps[ludum_dare]
            cmd = message["cmd"]
            seq = message.get("seq") or 0
            if cmd == "ip_lookup":
                ip, ip_lookup = self.request.remote_ip, None
                ip_lookup = geoloc.resolve_ip(ip)
                if update_map.debug_jobs and not ip_lookup:
                    ip = "%d.%d.%d.%d" % (random.randint(0,255),
                        random.randint(0,255),random.randint(0,255),random.randint(0,255))
                    ip_lookup = geoloc.resolve_ip(ip);
                    if(ip_lookup):
                        self.write_message(json.dumps({"chat":{
                                    "Server": "(I couldn't determine a location for %s so I pretended you were at %s)" % (self.request.remote_ip, ip),
                        }}))
                    logging.info("IP lookup: %s -> %s", ip, ip_lookup)
                self.write_message(json.dumps({"ip":ip,"ip_lookup":ip_lookup}));
            elif cmd == "get_users":
                users = []
                if seq < update_map.seq:
                    for author in update_map.authors_by_uid.values():
                        if author.seq > seq and author.get("position") and ludum_dare_id in author.comps:
                            users.append(author)
                self.write_message(json.dumps({"seq":update_map.seq,"users":users}))
            elif cmd == "get_user":
                user = None
                uid = message.get("uid")
                if uid:
                    user = update_map.authors_by_uid.get(str(uid))
                else:
                    user = update_map.authors_by_username.get(message.get("username"))
                    if not user:
                        user = update_map.authors_by_username.get(message.get("username","").lower())
                if message.get("token") == "guess":
                    logging.info("%s guesses they are %s: %s",geoloc.pretty_ip(self.request.remote_ip),uid or message.get("username"), user.uid if user else "nope")
                self.write_message(json.dumps({"user":user,"token":message.get("token"),
                    "uid":uid,"username":message.get("username")}))
            elif cmd == "set_location":
                uid = str(message.get("uid"))
                assert uid in update_map.authors_by_uid, uid
                lat, lng = message["position"]
                assert isinstance(lng, (int, float))
                assert isinstance(lat, (int, float))
                with update_map.seq_lock:
                    author = update_map.authors_by_uid[uid]
                    if lng < -180 or lng > 180 or lat < -90 or lat > 90:
                        # decided to log it, not to stop it for the user's session; let them think they're clever, that
                        # might discourage them from being too much of a vandal.  Authentication is why we can't have nice things.
                        logging.error("%s sets invalid location %s -> %s", uid, author.get("position"), message["position"])
                    elif message["position"] != author.get("position"):
                        logging.info("%s sets their location %s -> %s", uid, author.get("position"), message["position"])
                        author.position = [lat, lng]
                        update_map.seq += 1
                        author.seq = update_map.seq
                        update_map.save_data()
            elif cmd == "get_comments":
                uid = str(message.get("uid"))
                assert uid in update_map.authors_by_uid, uid
                ludum_dare_id = update_map.comps[ludum_dare]
                users = []
                commented = []
                for author in update_map.authors_by_uid.itervalues():
                    if "position" in author and ludum_dare_id in author.comps:
                        for u, _ in author.get("commenters", ""):
                            if u == uid:
                                commented.append(author.uid)
                                if author.seq > seq:
                                    users.append(author)
                                break
                commenters = []
                author = update_map.authors_by_uid[uid]
                for u, _ in author.get("commenters", ""):
                    author = update_map.authors_by_uid.get(u) # can have scaped one before the other
                    if author and "position" in author and ludum_dare_id in author.comps:
                        commenters.append(u)
                self.write_message(json.dumps({
                        "seq": update_map.seq,
                        "users": users,
                        "commented": commented,
                        "commenters": commenters,
                }))
            else:
                raise Exception("unsupported cmd: %s" % cmd)
        except:
            logging.error("ERROR processing %s: %s",self.request.remote_ip,message)
            traceback.print_exc()
            self.close()
    def write_message(self,msg):
        if self.closed: return
        try:
            tornado.websocket.WebSocketHandler.write_message(self,msg)
        except Exception as e:
            logging.error("ERROR sending message to %s: %s",geoloc.pretty_ip(self.request.remote_ip),e)
            self.closed = True
            self.close()
    def on_close(self):
        if self.closed: return
        self.closed = True
        
def get_info():
    ludum_dare_id = update_map.comps[ludum_dare]
    authors_with_position = set(uid for uid,author in update_map.authors_by_uid.iteritems() if "position" in author and ludum_dare_id in author.comps)
    comments_by_positioners = 0
    commenters = collections.defaultdict(list)
    for uid in authors_with_position:
        author = update_map.authors_by_uid[uid]
        if "commenters" in author:
            comments = set(uid for uid, _ in author.commenters) & authors_with_position
            for commenter in comments:
                commenters[commenter].append(uid)
            comments_by_positioners += len(comments)
    ret = "<html><body><pre>%d authors, %d comments\n" % (len(authors_with_position), comments_by_positioners)
    ret += json.dumps(commenters, indent=2)
    return ret

def init():
    geoloc.load_ip_locations()
    update_map.load_data(ludum_dare)
    update_map.start(ludum_dare, options.interval)
