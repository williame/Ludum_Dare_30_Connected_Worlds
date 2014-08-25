
function make_mask(uid, tex) {
	var w = 640, h = 480, r = 20;
	var mask = new Uint32Array(w*h);
	var line = function(x1,y,x2) {
		var ofs = y*w + x1;
		for(var x=x1; x<x2; x++)
			mask[ofs++] = 0xffffffff;
	};
	for(var c in user.commenters) {
		c = user.commenters[c][0];
		if(c in users)
			users[c].commented_on_us = true;
	}
	for(var u in users) {
		u = users[u];
		if(!u.position)
			continue;
		if(!u.we_commented_on_them) {
			for(var c in u.commenters)
				if(u.commenters[c][0] == uid) {
					u.we_commented_on_them = true;
					break;
				}
		}
		if(u == user || u.commented_on_us || u.we_commented_on_them) {
			var	pos = u.position,
				x0 = (w * ((pos.lng + 180) / 360)) | 0,
				y0 = h - (h * ((pos.lat + 90) / 180)) | 0,
				x = r, y = 0, err = 1-x;
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
