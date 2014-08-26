
var server_websocket;
var debug = false;

function is_interactive() { return debug || server_websocket; }

var DEG2RAD = Math.PI/180;
var RAD2DEG = 180/Math.PI;
var intro_millis = 1500;

function LatLng(lat,lng) {
	assert(this instanceof LatLng);
	this.lat = lat;
	this.lng = lng;
}
LatLng.prototype = {
	to_mercator: function() {
		var y = this.lat * DEG2RAD;
		y = RAD2DEG * Math.log(Math.tan(Math.PI/4.0+y*DEG2RAD/2.0));
		return [this.lng * DEG2RAD, y, 0];
	},
	distance: function(other) {
		assert(other instanceof LatLng);
		var	lng1 = this.lng, lat1 = this.lat,
			lng2 = other.lng, lat2 = other.lat,
			dlat = (lat2-lat1) * DEG2RAD,
			dlng = (lng2-lng1) * DEG2RAD;
		lat1 *= DEG2RAD;
		lat2 *= DEG2RAD;			
		var	a = Math.sin(dlat/2) * Math.sin(dlat/2) +
				Math.cos(lat1) * Math.cos(lat2) *
				Math.sin(dlng/2) * Math.sin(dlng/2),
			c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
		return 6371 * c;
	},
};
LatLng.from_mercator = function(pos) {
	var x = pos[0], y = pos[1];
	return new LatLng(RAD2DEG * RAD2DEG*Math.log(Math.tan(Math.PI/4.0+y*DEG2RAD/2.0)),x * RAD2DEG);
};

function nearest_users(pos) {
	var candidates = [];
	for(var u in users) {
		u = users[u];
		if(u.position) {
			var distance = pos.distance(u.position);
			candidates.push([distance,u]);
		}
	}
	candidates.sort(function(a,b) { return a[0]-b[0]; });
	return candidates;
}

function load_shapefile(data) {
	var shp = new BinaryDataReader(data);
	shp.seek(24);
	var len = shp.swap32(shp.uint32()) * 2;
	assert(len == data.byteLength);
	shp.seek(100);
	var points = [], shapes = [], polygons = [];
	while(shp.ofs < len) {
		shp.skip(4);
		var next = shp.ofs + (2 * shp.swap32(shp.uint32())) + 4;
		assert(shp.uint32() == 5); // we only have polygons
		shp.skip(4*8);
		var num_parts = shp.uint32(), num_points = shp.uint32();
		var parts = shp.uint32(num_parts);
		points.push.apply(points,shp.float64(num_points*2));
		var start = 0;
		for(var i=1; i<num_parts; i++) {
			var end = parts[i];
			shapes.push(end-start);
			start = end;
		}
		shapes.push(num_points-start);
		shp.seek(next);
	}
	for(var i in points)
		points[i] *= DEG2RAD;
	gl.bindBuffer(gl.ARRAY_BUFFER,world_map.vbo);
	gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(points),gl.STATIC_DRAW);
	gl.bindBuffer(gl.ARRAY_BUFFER,null);
	world_map.shapes = shapes;
	world_map.start_time = now();
}

var selected_user;
var ticks = [];
var ip_pos, user = {}, users = {};
var last_draw = now();
var still_in_intro = true;
var ctx = new UIContext();
var world_map = {
	pMatrix: mat4_identity,
	mvMatrix: mat4_identity,
	vbo: gl.createBuffer(),
	zoom: 1.5,
	shapes: [],
	start_time: null,
	mask: null,
	program: Program(
		"precision mediump float;\n"+
		"#define PI 3.1415926535897932384626433832795\n"+ // madness!
		"attribute vec2 vertex;\n"+
		"uniform mat4 mvMatrix, pMatrix;\n"+
		"uniform float t;\n"+
		"void main() {\n"+
		"	float lat = vertex.y, lng = vertex.x;\n"+
		"	vec3 merc = vec3(lng, 180.0/PI * log(tan(PI/4.0+lat*(PI/180.0)/2.0)), 0.0);\n"+
		"	vec4 pos = vec4(merc,1.0);\n"+
		"	if(t < 1.0) {\n"+
		"		vec3 globe = vec3(-cos(lat)*cos(lng),sin(lat),cos(lat)*sin(lng));\n"+
		"		pos = vec4(mix(globe,merc,t),1.0);\n"+
		"	}\n"+
		"	gl_Position = pMatrix * mvMatrix * pos;\n"+
		"}\n",
		"precision mediump float;\n"+
		"uniform vec4 colour;\n"+
		"void main() {\n"+
		"	gl_FragColor = colour;\n"+
		"}\n"),
	draw: function() {
		if(!this.shapes.length)
			return;
		var intro_anim_t = (now()-this.start_time) / intro_millis;
		if(intro_anim_t > 1 && still_in_intro) {
			still_in_intro = false;
			prompt_intro();
		}
		this.program(function() {
				gl.bindBuffer(gl.ARRAY_BUFFER,this.vbo);
				gl.vertexAttribPointer(this.program.vertex,2,gl.FLOAT,false,0,0);
				var shapes = this.shapes;
				var start = 0;
				for(var shape in shapes) {
					var len = shapes[shape];
					assert(len > 0);
					gl.drawArrays(gl.LINE_STRIP,start,len);
					start += len;
				}
			}, {
				pMatrix: this.pMatrix,
				mvMatrix: this.mvMatrix,
				colour: [0.5, 1, 1, 1],
				t: intro_anim_t,
			}, this);
	},
};

var	mercator_bl = new LatLng(-94, -180).to_mercator(),
	mercator_tr = new LatLng(90, 180).to_mercator(); // our map isn't perfectly aligned
	
function user_colour(user, subdue) {
	var b = (!subdue && user == selected_user? 0: 0.5);
	if(user == window.user)
		return [1,1,1,1]; // white
	else if(user.commented_on_us && user.we_commented_on_them)
		return [1,1,b,1]; // yellow
	else if(user.we_commented_on_them)
		return [b,1,b,1]; // green
	else if(user.commented_on_us)
		return [b,b,1,1]; // blue
	else
		return [1,b,b,1]; // red
}

function draw_user(user,mvpInv,pin,pin_bg) {
	var p = user.position.to_mercator();
	p = mat4_vec3_multiply(mvpInv, mat4_vec3_multiply(world_map.mvpMatrix, p));
	var x = p[0], y = p[1];
	user.screen_pos = [x, y];
	if(pin_bg && (user == window.user || user == selected_user || user.commented_on_us || user.we_commented_on_them))
		ctx.drawRect(pin_bg,OPAQUE,x-pin.width/2,y-pin.height,x+pin.width/2,y,0,0,1,1);
	ctx.drawRect(pin,user_colour(user),x-pin.width/2,y-pin.height,x+pin.width/2,y,0,0,1,1);
}

function update_ctx() {
	var pin = getFile("image", "data/pin.png");
	var pin_bg = getFile("image", "data/pin_bg.png");
	if(!pin || !ctx.mvpMatrix)
		return;
	var mvpInv = mat4_inverse(ctx.mvpMatrix);
	var bl = mat4_vec3_multiply(mvpInv, mat4_vec3_multiply(world_map.mvpMatrix, mercator_bl));
	var tr = mat4_vec3_multiply(mvpInv, mat4_vec3_multiply(world_map.mvpMatrix, mercator_tr));
	var draw_map = function(map) { ctx.drawRect(map,OPAQUE,bl[0],tr[1],tr[0],bl[1],0,0,1,1); };
	ctx.clear();
	var mask = world_map.mask;
	if(mask) {
		var map_bg = getFile("image", "data/map1.jpg");
		var map_fg = getFile("image", "data/map1.png");
		ctx.insert(function() {
			gl.enable(gl.STENCIL_TEST);
			gl.stencilFunc(gl.NEVER,1,0xff);
			gl.stencilOp(gl.REPLACE,gl.KEEP,gl.KEEP);
		});
		draw_map(mask);
		if(map_bg)
			ctx.insert(function() {
				gl.stencilOp(gl.KEEP,gl.KEEP,gl.KEEP);
				gl.stencilFunc(gl.EQUAL,1,0xff);
			});
		if(map_bg) {
			draw_map(map_bg);
		}
		ctx.insert(function() { gl.disable(gl.STENCIL_TEST); });
	}
	ctx.inject(function() { world_map.draw(); });
	if(mask) {
		if(map_fg) {
			ctx.insert(function() { gl.enable(gl.STENCIL_TEST); });
			draw_map(map_fg);
			ctx.insert(function() { gl.disable(gl.STENCIL_TEST); });
		}
		ctx.insert(function() { gl.blendFunc(gl.DST_COLOR,gl.ONE_MINUS_SRC_ALPHA); });
		draw_map(world_map.mask);
		ctx.insert(function() { gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA); });
	}
	for(var u in users) {
		u = users[u];
		if(u.position)
			draw_user(u,mvpInv,pin,pin_bg);
	}
	if(!user.uid && user.position)
		draw_user(user,mvpInv,pin,pin_bg);
	if(selected_user) {
		var font = UI.fonts["default"] || null;
		var pos = selected_user.position.to_mercator();
		pos = mat4_vec3_multiply(mvpInv, mat4_vec3_multiply(world_map.mvpMatrix, pos));
		var	sz = ctx.measureText(font, selected_user.name),
			w = sz[0]/ 2,
			m = 5, x = pos[0], y = pos[1];
		ctx.fillRect(user_colour(selected_user,true),x-w-m,y,x+w+m,y+sz[1]+m+m);
		ctx.drawTextOutlined(font,[1,1,1,1],[0,0,0,1],x-w,y+m,selected_user.name);
	}
	ctx.finish();
}

function new_game() {
	loading = true;
	canvas.setAttribute('tabindex','0');
	canvas.focus();
	var bg = [0.1,0.3,0.6,1];
	gl.clearColor.apply(gl,bg);
	onResize();
	loadFile("image", "data/pin.png", update_ctx);
	loadFile("image", "data/pin_bg.png", update_ctx);
	try {
		var aliasedLineRange = gl.getParameter(gl.ALIASED_LINE_WIDTH_RANGE);
		if(aliasedLineRange)
			gl.lineWidth(Math.min(Math.max(aliasedLineRange[0], 3), aliasedLineRange[1]));
	} catch(error) {
		console.log("ERROR setting aliased line:", error);
	}
	loadFile("ArrayBuffer","external/TM_WORLD_BORDERS_SIMPL-0.3/TM_WORLD_BORDERS_SIMPL-0.3.shp",load_shapefile);
	bg = ((255*bg[3]) << 24) | ((255*bg[2]) << 16) | ((255*bg[1]) << 8) | (255*bg[0]);
	bg = 0xFFFFFFFF + bg + 1;
	console.log("bg",bg.toString(16));
}

function connect_to_server() {
	server_websocket = create_websocket_connection(function(evt) {
			data = JSON.parse(evt.data);
			console.log("RECV:", data);
			if(data.seq)
				server_websocket.seq = data.seq;
			if("ip_lookup" in data) {
				if(data.ip_lookup) {
					ip_pos = data.ip_lookup;
					var base = new LatLng(ip_pos[6], ip_pos[7]);
					do {
						ip_pos.latlng = new LatLng(ip_pos[6] + Math.random() * 0.1, ip_pos[7] + Math.random() * 0.1);
					} while(base.distance(ip_pos.latlng) > 10);
					go_to(ip_pos.latlng.to_mercator(),0.3);
				}
				prompt_for_user();
			}
			if(data.users) {
				for(var u in data.users) {
					u = data.users[u];
					if(u.position)
						u.position = new LatLng(u.position[0], u.position[1]);
					users[u.uid] = u;
					if(user.uid == u.uid) {
						user = u;
						make_relationships(user);
					} else
						make_relationships(user, u);
				}
				update_ctx();
			}
			if(data.users || data.commenters) {
				world_map.mask = make_mask(user.uid, world_map.mask);
			}
			if(data.user) {
				var old_pos = user.position;
				users[data.user.uid] = data.user;
				if(data.user.uid == user.uid)
					user = data.user;
				data.user.full = true;
				if(data.user.position) {
					data.user.position = new LatLng(data.user.position[0],data.user.position[1]);
					update_ctx();
				}
				if(data.token == "guess") {
					user = data.user;
					if(user.position) {
						prompt_position(user.name + "!  ... LD already has a last reported location for you on file; can you double check please?");
					} else if(old_pos) {
						// aha! set it
						user.position = old_pos;
						server_websocket.send(JSON.stringify({
							"cmd":"set_location",
							"uid":data.user.uid,
							"position":[user.position.lat,user.position.lng],
						}));
						user_ready();
					}
				}
			} else if(data.token == "guess") {
				prompt_unknown_user(data.uid || data.username);
			}
			for(var name in data.chat)
				UI.addMessage(10,name,data.chat[name]);
			update_ctx();
	});
	server_websocket.send(JSON.stringify({"cmd":"ip_lookup"}));
	server_websocket.send(JSON.stringify({"cmd":"get_users"}));
}

var anim_path = [[now(),[0,0],1.5]];

function clamp_zoom(zoom) { return Math.max(Math.min(zoom, 1.5), 0.1); }

function go_to(pos,zoom,speed) {
	var p = anim_path[anim_path.length-1];
	if(anim_path.length == 1)
		p[0] = now();
	zoom = clamp_zoom(zoom || p[2]);
	if(anim_path.length == 3) {
		anim_path[1] = [p[0],pos,zoom];
	} else {
		var distance = vec2_length([pos[0]-p[1][0],pos[1]-p[1][1]]);
		var duration = distance? distance * (speed || 1000): (speed || 1000);
		anim_path.push([p[0]+duration,pos,zoom]);
	}
	console.log("go_to",pos,zoom,speed,anim_path);
}

function current_anim() {
	var now = window.now();
	while(anim_path.length > 1 && anim_path[1][0] < now) {
		anim_path.shift();
	}
	var 	start = anim_path[0],
		x = start[1][0],
		y = start[1][1],
		zoom = start[2];
	if(anim_path.length == 1)
		start[0] = now;
	if(anim_path.length > 1 && start[0] < now) {
		var	next = anim_path[1],
			t = (now - start[0]) / (next[0] - start[0]);
		x = lerp(x, next[1][0], t);
		y = lerp(y, next[1][1], t);
		zoom = lerp(zoom, next[2], t);
	}
	return [x,y,zoom];
}

function onResize() {
	var	p = current_anim(),
		x = p[0], y = p[1], zoom = p[2],
		xaspect = canvas.width>canvas.height? canvas.width/canvas.height: 1,
		yaspect = canvas.width<canvas.height? canvas.height/canvas.width: 1,
		ortho = [-zoom*xaspect + x,zoom*xaspect + x,-zoom*yaspect + y,zoom*yaspect + y];
	world_map.pMatrix = createOrtho2D(ortho[0],ortho[1],ortho[2],ortho[3],-2,2);
	world_map.mvpMatrix = world_map.pMatrix;
	if(ctx.width != canvas.offsetWidth || ctx.height != canvas.offsetHeight || !ctx.mvpMatrix) {
		ctx.width = canvas.offsetWidth;
		ctx.height = canvas.offsetHeight;
		ctx.mvpMatrix = new Float32Array(createOrtho2D(0,ctx.width,ctx.height,0));
	}
	update_ctx();
}

function onMouseWheel(evt, delta) {
	if(!is_interactive()) return;
	if(anim_path.length == 1) {
		var zoom = clamp_zoom(anim_path[0][2] + delta * 0.001);
		if(zoom != anim_path[0][2]) {
			anim_path[0][2] = zoom;
			onResize();
		}
	}
}

function onKeyDown(evt) {
	if(is_interactive()) {
		switch(evt.which) {
		case 187: // +
			var last = anim_path[anim_path.length-1];
			var zoom = clamp_zoom(last[2] - 0.2);
			if(zoom != last[2])
				go_to(last[1],zoom,1000);
			break;
		case 189: // -
			var last = anim_path[anim_path.length-1];
			var zoom = clamp_zoom(last[2] + 0.2);
			if(zoom != last[2])
				go_to(last[1],zoom,1000);
			break;
		}
	}
	if(debug) {
		var tweak = evt.shiftKey? 0.02: 1;
		switch(evt.which) {
		case 87: mercator_bg[1] += tweak; break; // W
		case 83: mercator_bg[1] -= tweak; break; // S
		case 65: mercator_bg[3] += tweak; break; // A
		case 68: mercator_bg[3] -= tweak; break; // D
		case 73: mercator_bg[0] -= tweak; break; // I
		case 75: mercator_bg[0] += tweak; break; // K
		case 74: mercator_bg[2] -= tweak; break; // J
		case 76: mercator_bg[2] += tweak; break; // L
		default:
			return;
		}
		console.log("mercator_bg",mercator_bg[0],mercator_bg[1],mercator_bg[2],mercator_bg[3]);
		update_ctx();
	}
}

function mouse_to_mercator(evt, y_adjust) {
	var 	x = evt.clientX,
		y = canvas.height - evt.clientY + (y_adjust || 0);
	return unproject(x, y, world_map.mvpMatrix, mat4_identity, [0,0,canvas.width,canvas.height])[0];
}

function user_nearest_mouse(evt,y_adjust) {
	if(!is_interactive()) return null;
	candidates = nearest_users(LatLng.from_mercator(mouse_to_mercator(evt,y_adjust)));
	if(candidates.length && candidates[0][0] < 100)
		return candidates[0][1];
	return null;
}

function onMouseDown(evt) {
	canvas.focus();
	var u = user_nearest_mouse(evt,-16);
	if(u && selected_user == u) {
		onUserClick(u);
	} else {
		selected_user = u;
		if(u)
			go_to(u.position.to_mercator(), anim_path[anim_path.length-1][2]);
		else
			go_to(mouse_to_mercator(evt), anim_path[anim_path.length-1][2]);
	}
}

function onMouseMove(evt) {
	var u = user_nearest_mouse(evt,true);
	if(selected_user != u) {
		selected_user = u;
		update_ctx();
	}
}

function render() {
	if(ticks.length) {
		var old_ticks = ticks;
		ticks = [];
		for(var i in old_ticks)
			old_ticks[i]();
	}
	var elapsed = now() - last_draw;
	last_draw += elapsed;
	
	gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT|gl.STENCIL_BUFFER_BIT);
	
	if(anim_path.length > 1) {
		onResize();
	} else if(is_interactive()) {
		var x = 0, y = 0;
		if(keys[38] && !keys[40]) // down
			y = 0.005 * elapsed;
		else if(keys[40] && !keys[38]) // up
			y -= 0.005 * elapsed;
		if(keys[37] && !keys[39]) // left
			x -= 0.005 * elapsed;
		else if(keys[39] && !keys[37]) // right
			x = 0.005 * elapsed;
		if(x || y) {
			anim_path[0][1][0] += x * anim_path[0][2];
			anim_path[0][1][1] += y * anim_path[0][2];
			onResize();
		}
	}
	ctx.draw(ctx.mvpMatrix);
}
