
function make_mask(uid, tex, bgcolor) {
	var w = 640, h = 480, r = 20;
	var mask = new Uint32Array(w*h);
	for(var i=0; i<mask.length; i++)
		mask[i] = bgcolor;
	var line = function(x1,y,x2) {
		var ofs = y*w + x1;
		for(var x=x1; x<x2; x++)
			mask[ofs++] = 0x000000ff;
	};
	for(var i=0; i<10; i++) {
		var x0 = parseInt(r + Math.random() * (w - r*2));
		var y0 = parseInt(r + Math.random() * (h - r*2));
		var x = r, y = 0;
		var err = 1-x;
		while(x >= y) {
			line(-x + x0,  y + y0, x + x0);
			line(-x + x0, -y + y0, x + x0);
			line(-y + x0, -x + y0, y + x0);
			line(-y + x0,  x + y0, y + x0);
			y++;
			if (err<0) {
				err += 2 * y + 1;
			} else {
				x--;
				err += 2 * (y - x + 1);
			}
		}
	}
	return createTexture(tex, w, h, new Uint8Array(mask.buffer));
}
