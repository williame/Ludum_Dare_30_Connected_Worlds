
var	deg2rad = Math.PI/180,
	maxZoom = 80, minZoom = 20,
	zoom = 70;
	
var world_map = {
	vbo: gl.createBuffer(),
	pMatrix: mat4_identity,
	mvMatrix: mat4_identity,
	start_time: null,
	program: Program(
		"precision mediump float;\n"+
		"#define PI 3.1415926535897932384626433832795\n"+ // madness!
		"attribute vec2 vertex;\n"+
		"uniform mat4 mvMatrix, pMatrix;\n"+
		"uniform float t;\n"+
		"void main() {\n"+
		"	float lat = vertex.y, lng = vertex.x;\n"+
		"	vec3 globe = vec3(-cos(lat)*cos(lng),sin(lat),cos(lat)*sin(lng));\n"+
		"	vec3 merc = vec3(lng, 180.0/PI * log(tan(PI/4.0+lat*(PI/180.0)/2.0)), 0);\n"+
		"	gl_Position = pMatrix * mvMatrix * vec4(mix(globe,merc,t),1.0);\n"+
		"}\n",
		"precision mediump float;\n"+
		"uniform vec4 colour;\n"+
		"void main() {\n"+
		"	gl_FragColor = colour;\n"+
		"}\n"),
	draw: function() {
		if(!this.data && !load_world_map())
			return;
		this.program(function() {
				gl.bindBuffer(gl.ARRAY_BUFFER,this.vbo);
				gl.vertexAttribPointer(this.program.vertex,2,gl.FLOAT,false,2*4,0);
				var ofs = 0, parts = this.data.ofs;
				for(var part=0; part<parts.length; part++) {
					var start = ofs;
					ofs += parts[part];
					gl.drawArrays(gl.LINE_STRIP,start,ofs-start);
				}
			}, {
				pMatrix: this.pMatrix,
				mvMatrix: this.mvMatrix,
				colour: [0, 1, 0, 1],
				t: Math.min(1, (now()-this.start_time) / 3000),
			}, this);
		var ofs = 0, parts = this.data.ofs;
		for(var part=0; part<parts.length; part++) {
			var start = ofs;
			ofs += parts[part];
			gl.drawArrays(gl.LINE_STRIP,start,ofs-start);
		}
	},
};

function new_game() {
	loading = false;
	onResize();
}

function load_world_map() {
	world_map.data = getFile("json","data/world.json");
	if(world_map.data) {
		for(var i in world_map.data.pts)
			world_map.data.pts[i] *= deg2rad;
		gl.bindBuffer(gl.ARRAY_BUFFER,world_map.vbo);
		gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(world_map.data.pts),gl.STATIC_DRAW);
		gl.bindBuffer(gl.ARRAY_BUFFER,null);
		world_map.start_time = now();
		return true;
	}
	return false;
}

function onResize() {
	var	zoomFactor = 0.3+(zoom-minZoom)/(maxZoom-minZoom),
		xaspect = canvas.width>canvas.height? canvas.width/canvas.height: 1,
		yaspect = canvas.width<canvas.height? canvas.height/canvas.width: 1,
		ortho = [-zoomFactor*xaspect,zoomFactor*xaspect,-zoomFactor*yaspect,zoomFactor*yaspect];
	world_map.pMatrix = createOrtho2D(ortho[0],ortho[1],ortho[2],ortho[3],-2,2);
}

function render() {
	gl.clear(gl.DEPTH_BIT|gl.COLOR_BIT);
	world_map.draw();
}
