
var	deg2rad = Math.PI/180,
	maxZoom = 80, minZoom = 20,
	zoom = 70;
	
var world_map = {
	vbo: gl.createBuffer(),
	pMatrix: mat4_identity,
	mvMatrix: mat4_identity,
	program: Program(
		"precision mediump float;\n"+
		"attribute vec2 vertex;\n"+
		"uniform mat4 mvMatrix, pMatrix;\n"+
		"void main() {\n"+
		"	float lat = vertex.y, lng = vertex.x;\n"+
		"	float x = -cos(lat)*cos(lng);\n"+
		"	float y = sin(lat);\n"+
		"	float z = cos(lat)*sin(lng);\n"+
		"	gl_Position = pMatrix * mvMatrix * vec4(x,y,z,1.0);\n"+
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
	splash.dismiss();
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
	world_map.draw();
}
