
var server_websocket;

function load_shapefile(data) {
	var shp = new BinaryDataReader(data);
	shp.seek(24);
	var len = shp.swap32(shp.uint32()) * 2;
	assert(len == data.byteLength);
	shp.seek(100);
	var points = [], shapes = [];
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
		points[i] *= Math.PI/180;
	gl.bindBuffer(gl.ARRAY_BUFFER,world_map.vbo);
	gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(points),gl.STATIC_DRAW);
	gl.bindBuffer(gl.ARRAY_BUFFER,null);
	world_map.shapes = shapes;
	world_map.start_time = now();
}

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
		"	vec3 merc = vec3(lng, 180.0/PI * log(tan(PI/4.0+lat*(PI/180.0)/2.0)), 0);\n"+
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
		if(!this.shapes)
			return;
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
				colour: [0, 1, 0, 1],
				t: (now()-this.start_time) / 3000,
			}, this);
	},
};

function new_game() {
	onResize();
	loading = false;
	server_websocket = create_websocket_connection(function(evt) {
			console.log("GOT", evt);
	});
	try {
		var aliasedLineRange = gl.getParameter(gl.ALIASED_LINE_WIDTH_RANGE);
		if(aliasedLineRange)
			gl.lineWidth(Math.min(Math.max(aliasedLineRange[0], 3), aliasedLineRange[1]));
	} catch(error) {
		console.log("ERROR setting aliased line:", error);
	}
	loadFile("ArrayBuffer","external/TM_WORLD_BORDERS_SIMPL-0.3/TM_WORLD_BORDERS_SIMPL-0.3.shp",load_shapefile);
}

function onResize() {
	var	zoomFactor = world_map.zoom,
		xaspect = canvas.width>canvas.height? canvas.width/canvas.height: 1,
		yaspect = canvas.width<canvas.height? canvas.height/canvas.width: 1,
		ortho = [-zoomFactor*xaspect,zoomFactor*xaspect,-zoomFactor*yaspect,zoomFactor*yaspect];
	world_map.pMatrix = createOrtho2D(ortho[0],ortho[1],ortho[2],ortho[3],-2,2);
}

function render() {
	if(loading) return;
	gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
	world_map.draw();
}
