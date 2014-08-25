import random, json, time

import tornado.websocket
from tornado.options import options

import update_map, geoloc

ludum_dare = 'ludum-dare-27-warmup'

class LD30WebSocket(tornado.websocket.WebSocketHandler):
    closed = False
    def allow_draft76():
    	    print "draft76 rejected"
    	    return False
    def open(self):
        self.origin = self.request.headers.get("origin","")
        self.userAgent = self.request.headers.get("user-agent")
        print "connection",self.request.remote_ip, self.origin, self.userAgent
        if not any(map(self.origin.startswith, (options.origin, "http://31.192.226.244:", "http://localhost:"))):
            print "kicking out bad origin"
            self.write_message('{"chat":[{"Will":"if you fork the code, you need to run your own server!"}]}')
            self.close()
        ip, ip_lookup = self.request.remote_ip, None
        ip_lookup = geoloc.resolve_ip(ip)
        if False and not ip_lookup:
            ip = "%d.%d.%d.%d" % (random.randint(0,255),
                random.randint(0,255),random.randint(0,255),random.randint(0,255))
            ip_lookup = geoloc.resolve_ip(ip);
            if(ip_lookup):
                self.write_message(json.dumps({"chat":{
                            "Server": "(I couldn't determine a location for %s so I pretended you were at %s)" % (self.request.remote_ip, ip),
                }}))
            print "(ip %s -> %s)" % (ip, ip_lookup)
        self.write_message(json.dumps({"ip":ip,"ip_lookup":ip_lookup}));
    def on_message(self,message):
        global seq
        self.lastMessage = time.time()
        try:
            message = json.loads(message)
            assert isinstance(message,dict)
            ludum_dare_id = update_map.comps[ludum_dare]
            cmd = message["cmd"]
            seq = message.get("seq") or 0
            if cmd == "get_locations":
                locations = []
                for author in update_map.authors_by_uid.values():
                    if author.seq > seq and author.get("position") and ludum_dare_id in author.comps:
                        locations.append([author.uid,author.position,author.name,[t[1] for t in author.get("targets",[])]])
                self.write_message(json.dumps({"seq":update_map.seq,"locations":locations}))
            elif cmd == "get_user":
                user = None
                uid = message.get("uid")
                if uid:
                    user = update_map.authors_by_uid.get(str(uid))
                else:
                    user = update_map.authors_by_username.get(message.get("username"));
                self.write_message(json.dumps({"user":user,"token":message.get("token"),
                    "uid":uid,"username":message.get("username")}));
            else:
                raise Exception("unsupported cmd: %s" % cmd)
        except:
            print "ERROR processing",self.request.remote_ip,message
            traceback.print_exc()
            self.close()
    def write_message(self,msg):
        if self.closed: return
        try:
            tornado.websocket.WebSocketHandler.write_message(self,msg)
        except Exception as e:
            print "ERROR sending join to",self.name,e
            self.closed = True
            self.close()
    def on_close(self):
        if self.closed: return
        self.closed = True

def init():
    geoloc.load_ip_locations()
    update_map.load_data()
    ### update_map.tick(ludum_dare)
