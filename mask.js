
function make_mask(uid, tex) {
	var w = 640, h = 480, r = 20;
	var mask = new Uint32Array(w*h);
	var line = function(x1,y,x2) {
		var ofs = y*w + x1;
		for(var x=x1; x<x2; x++)
			mask[ofs++] = 0xffffffff;
	};
	var commenters = {};
	for(var c in user.commenters)
		commenters[c[0]] = 1;
	console.log("commented:",commenters);
	for(var u in users) {
		u = users[u];
		if(!u.position)
			continue;
		var is_commenter = false;
		for(var c in u.commenters)
			if(u.commenters[c][0] == uid) {
				is_commenter = true;
				break;
			}
		if(u == user || is_commenter || u.uid in commenters) {
			var	pos = u.position,
				x0 = (w * ((pos.lng + 180) / 360)) | 0,
				y0 = h - (h * ((pos.lat + 90) / 180)) | 0,
				x = r, y = 0, err = 1-x;
			console.log("mask",u.uid, u.name, pos, "->", x0, y0);
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
	}
	return createTexture(tex, w, h, new Uint8Array(mask.buffer));
}
