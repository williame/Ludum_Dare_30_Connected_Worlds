
var server_websocket;
var DEG2RAD = Math.PI/180;

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

var users = {};
var foreground = new UIContext();
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
		var intro_anim_t = (now()-this.start_time) / 3000;
		if(intro_anim_t > 1 && !server_websocket)
			connect_to_server();
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
				colour: [0.8, 1, 0.8, 1],
				t: intro_anim_t,
			}, this);
	},
};

function update_foreground() {
	var pin = getFile("image", "data/pin.png");
	if(!pin || !foreground.mvpMatrix)
		return;
	foreground.clear();
	mvpInv = mat4_inverse(foreground.mvpMatrix);
	for(var user in users) {
		user = users[user];
		var p = [user.position[1], user.position[0], 0];
		p = mat4_vec3_multiply(mvpInv, mat4_vec3_multiply(world_map.mvpMatrix, p));
		var x = p[0], y = p[1];
		foreground.drawRect(pin,OPAQUE,x-pin.width/2,y-pin.height,x+pin.width/2,y,0,0,1,1);
	}
	foreground.finish();
}

function make_splash() {
	var panel = new UIPanel([
			new UIImage("data/pin.png"),
		]);
	panel.afterLayout = function() {
		panel.setPos([((canvas.offsetWidth-panel.width()) / 2) | 0,
			((canvas.offsetHeight-panel.height()) / 2) | 0]);
	};
	var win = new UIWindow(false,panel);
	win.show();
}

function new_game() {
	loading = false;
	gl.clearColor(0.7,0.8,1,1);
	make_splash();
	onResize();
	loadFile("image", "data/pin.png", update_foreground);
	try {
		var aliasedLineRange = gl.getParameter(gl.ALIASED_LINE_WIDTH_RANGE);
		if(aliasedLineRange)
			gl.lineWidth(Math.min(Math.max(aliasedLineRange[0], 3), aliasedLineRange[1]));
	} catch(error) {
		console.log("ERROR setting aliased line:", error);
	}
	loadFile("ArrayBuffer","external/TM_WORLD_BORDERS_SIMPL-0.3/TM_WORLD_BORDERS_SIMPL-0.3.shp",load_shapefile);
	loading = false;
}

function connect_to_server() {
	server_websocket = create_websocket_connection(function(evt) {
			data = JSON.parse(evt.data);
			console.log("got", data);
			for(var i in data.locations) {
				var loc = data.locations[i];
				var uid = loc[0], x = loc[1][1], y = loc[1][0], targets = loc[2];
				var user = users[uid] = users[uid] || {};
				user.uid = uid;
				y *= DEG2RAD;
				y = 180.0/Math.PI * Math.log(Math.tan(Math.PI/4.0+y*DEG2RAD/2.0));
				x *= DEG2RAD;
				user.position = [y, x];
				user.targets = targets;
			}
			if(data.ip_lookup) {
				var x = data.ip_lookup[7] * DEG2RAD;
				var y = data.ip_lookup[6] * DEG2RAD;
				console.log("GO TO",x,y);
				go_to(x,y,0.3);
			}
			for(var name in data.chat)
				UI.addMessage(10,name,data.chat[name]);
			update_foreground();
	});
	server_websocket.send(JSON.stringify({"cmd":"get_locations"}))
}

var anim_path = [[now(),0,0,1.5]];

function go_to(x,y,zoom,time) {
	var p = current_anim();
	var duration = vec2_length([x-p[0],y-p[1]]) * (time || 1000);
	anim_path.push([now()+duration,x,y,zoom || anim_path[0][3]]);
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
	if(foreground.width != canvas.offsetWidth || foreground.height != canvas.offsetHeight || !foreground.mvpMatrix) {
		foreground.width = canvas.offsetWidth;
		foreground.height = canvas.offsetHeight;
		foreground.mvpMatrix = new Float32Array(createOrtho2D(0,foreground.width,foreground.height,0));
	}
	update_foreground();
}

function render() {
	gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
	
	if(anim_path.length > 1)
		onResize();
		
	world_map.draw();
	foreground.draw(foreground.mvpMatrix);
}
