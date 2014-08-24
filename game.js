
var server_websocket;
var debug = false;

function is_interactive() { return debug || server_websocket; }

var DEG2RAD = Math.PI/180;
var intro_millis = 1500;

function to_mercator(lng, lat) {
	lng *= DEG2RAD;
	lng = 180.0/Math.PI * Math.log(Math.tan(Math.PI/4.0+lng*DEG2RAD/2.0));
	lat *= DEG2RAD;
	return [lng, lat];
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

var ticks = [];
var ip_pos, user = {}, users = {};
var last_draw = now();
var ctx = new UIContext();
var world_map = {
	pMatrix: mat4_identity,
	mvMatrix: mat4_identity,
	vbo: gl.createBuffer(),
	zoom: 1.5,
	shapes: [],
	start_time: null,
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
		if(intro_anim_t > 1 && loading) {
			loading = false;
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

var mercator_bg = [-180, -94, 180, 90]; // our map isn't perfectly aligned

function update_ctx() {
	var pin = getFile("image", "data/pin.png");
	if(!pin || !ctx.mvpMatrix)
		return;
	mvpInv = mat4_inverse(ctx.mvpMatrix);
	ctx.clear();
	var map = getFile("image", "data/map1.jpg");
	if(map) {
		var tl = mat4_vec3_multiply(mvpInv, mat4_vec3_multiply(world_map.mvpMatrix,
			vecN(to_mercator(mercator_bg[0],mercator_bg[1]),0)));
		var br = mat4_vec3_multiply(mvpInv, mat4_vec3_multiply(world_map.mvpMatrix,
			vecN(to_mercator(mercator_bg[2],mercator_bg[3]),0)));
		ctx.drawRect(map,OPAQUE,tl[0],tl[1],br[0],br[1],0,1,1,0);
	}
	ctx.inject(function() { world_map.draw(); });
	for(var user in users) {
		user = users[user];
		if(user.position) {
			var p = [user.position[1], user.position[0], 0];
			p = mat4_vec3_multiply(mvpInv, mat4_vec3_multiply(world_map.mvpMatrix, p));
			var x = p[0], y = p[1];
			user.screen_pos = [x, y];
			var colour = (user == window.user)? [0,1,0,1]: OPAQUE;
			ctx.drawRect(pin,colour,x-pin.width/2,y-pin.height,x+pin.width/2,y,0,0,1,1);
		}
	}
	ctx.finish();
}

function new_game() {
	loading = true;
	canvas.setAttribute('tabindex','0');
	canvas.focus();
	gl.clearColor(0.1,0.3,0.6,1);
	onResize();
	loadFile("image", "data/pin.png", update_ctx);
	try {
		var aliasedLineRange = gl.getParameter(gl.ALIASED_LINE_WIDTH_RANGE);
		if(aliasedLineRange)
			gl.lineWidth(Math.min(Math.max(aliasedLineRange[0], 3), aliasedLineRange[1]));
	} catch(error) {
		console.log("ERROR setting aliased line:", error);
	}
	loadFile("ArrayBuffer","external/TM_WORLD_BORDERS_SIMPL-0.3/TM_WORLD_BORDERS_SIMPL-0.3.shp",load_shapefile);
}

function connect_to_server() {
	server_websocket = create_websocket_connection(function(evt) {
			data = JSON.parse(evt.data);
			console.log("got", data);
			if(data.locations) {
				for(var i in data.locations) {
					var loc = data.locations[i];
					var uid = loc[0], lng = loc[1][0], lat = loc[1][1], targets = loc[2];
					var u = users[uid] = users[uid] || {};
					u.uid = uid;
					u.position = to_mercator(lng, lat);
					u.targets = targets;
				}
				prompt_for_user();
			}
			if(data.ip_lookup) {
				var x = data.ip_lookup[7] * DEG2RAD;
				var y = data.ip_lookup[6] * DEG2RAD;
				ip_pos = data.ip_lookup;
				go_to(x,y,0.3);
			}
			if(data.user) {
				users[data.user.uid] = data.user;
				data.user.full = true;
				if(data.user.position) {
					data.user.position = to_mercator(data.user.position[0],data.user.position[1]);
					update_ctx();
				}
				if(data.token == "guess") {
					user = data.user;
					prompt_position(user.name);
				}
			} else if(data.token == "guess") {
				prompt_unknown_user(data.uid || data.username);
			}
			for(var name in data.chat)
				UI.addMessage(10,name,data.chat[name]);
			update_ctx();
	});
	server_websocket.send(JSON.stringify({"cmd":"get_locations"}))
}

var anim_path = [[now(),0,0,1.5]];

function clamp_zoom(zoom) { return Math.max(Math.min(zoom, 1.5), 0.1); }

function go_to(x,y,zoom,speed) {
	var p = anim_path[anim_path.length-1];
	if(anim_path.length == 1)
		p[0] = now();
	zoom = clamp_zoom(zoom || p[3]);
	if(anim_path.length == 3) {
		anim_path[2] = [p[0],x,y,zoom];
	} else {
		var distance = vec2_length([x-p[1],y-p[2]]);
		var duration = distance? distance * (speed || 1000): (speed || 1000);
		anim_path.push([p[0]+duration,x,y,zoom]);
	}
}

function current_anim() {
	var now = window.now();
	while(anim_path.length > 1 && anim_path[1][0] < now) {
		anim_path.shift();
	}
	var 	start = anim_path[0],
		x = start[1],
		y = start[2],
		zoom = start[3];
	if(anim_path.length == 1)
		start[0] = now;
	if(anim_path.length > 1 && start[0] < now) {
		var	next = anim_path[1],
			t = (now - start[0]) / (next[0] - start[0]);
		x = lerp(x, next[1], t);
		y = lerp(y, next[2], t);
		zoom = lerp(zoom, next[3], t);
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
		var zoom = clamp_zoom(anim_path[0][3] + delta * 0.001);
		if(zoom != anim_path[0][3]) {
			anim_path[0][3] = zoom;
			onResize();
		}
	}
}

function onKeyDown(evt) {
	if(is_interactive()) {
		switch(evt.which) {
		case 187: // +
			var last = anim_path[anim_path.length-1];
			var zoom = clamp_zoom(last[3] - 0.2);
			if(zoom != last[3])
				go_to(last[1],last[2],zoom,1000);
			break;
		case 189: // -
			var last = anim_path[anim_path.length-1];
			var zoom = clamp_zoom(last[3] + 0.2);
			if(zoom != last[3])
				go_to(last[1],last[2],zoom,1000);
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

function onMouseDown(evt) {
	if(!is_interactive()) return;
	var pos = unproject(evt.clientX, canvas.height-evt.clientY, world_map.mvpMatrix, mat4_identity, [0,0,canvas.width,canvas.height])[0];
	go_to(pos[0], pos[1], anim_path[anim_path.length-1][3] * 0.5);
}

function onMouseMove(evt) {
	if(!is_interactive()) return;
	var pos = [evt.clientX, canvas.height-evt.clientY];
	var best, best_score;
	for(var user in users) {
		user = users[user];
		if(user.screen_pos) {
			var x = user.screen_pos[0], y = user.screen_pos[1];
			var d = vec2_distance([x, y-16], pos);
			if(!best || d < best_score) {
				best = user;
				best_score = d;
			}
		}
	}
	if(best && best_score < 10)
		console.log("click", best, best_score);
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
	
	gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
	
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
			anim_path[0][1] += x * anim_path[0][3];
			anim_path[0][2] += y * anim_path[0][3];
			onResize();
		}
	}
	ctx.draw(ctx.mvpMatrix);
}
