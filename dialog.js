function create_anchor(title, callback) {
	var a = document.createElement('a');
	a.appendChild(create_text(title));
	a.addEventListener('click',callback);
	return a;
}

function create_text(text, style) {
	text = text.replace(/&nbsp;/g,"\u00A0");
	text = document.createTextNode(text);
	if(style) {
		var node = document.createElement('span');
		for(var s in style)
			node.style[s] = style[s];
		node.appendChild(text);
		return node;
	}
	return text;
}

function slide_anim(element, appear, after, speed) {
	var height = element.clientHeight;
	var nodes = element.getElementsByTagName('*');
	for(var i = 0; i < nodes.length; i++)
		nodes[i].disabled = true;
	if(appear)
		element.style.marginBottom = "-" + height + "px";
	var last = now();
	var slide = function() {
		var t = now() - last;
		last += t;
		if(!appear) t = -t;
		var margin = parseInt(element.style.marginBottom);
		margin = Math.min(0, margin + t * (speed || 0.5));
		element.style.marginBottom = "" + margin + "px";
		if((appear && margin) || (!appear && margin > -height))
			ticks.push(slide);
		else {
			if(appear) {
				var nodes = element.getElementsByTagName('*');
				for(var i = 0; i < nodes.length; i++)
					nodes[i].disabled = false;
			}
			if(after)
				after();
		}
	};
	ticks.push(slide);
}

function prompt_intro() {
	var div = document.createElement('div');
	div.className = "bottom";
	div.appendChild(create_text("Hello Ludum Darer!"));
	div.appendChild(document.createElement('br'));
	div.appendChild(create_text("You inhabit a strange world, an underworld..."));
	div.appendChild(document.createElement('br'));
	div.appendChild(create_text("You inhabit the online world of "));
	div.appendChild(create_text("Ludum Dare!&nbsp;",{fontStyle:'italic', color:'pink'}));
	div.appendChild(create_anchor("I ADMIT IT", function() {
		slide_anim(div, false, function() {
			while(div.firstChild) div.removeChild(div.firstChild);
			div.appendChild(create_text("There's this thing called the&nbsp;"));
			div.appendChild(create_text("real",{fontStyle:'italic'}));
			div.appendChild(create_text("&nbsp;world too... ever heard of it?"));
			div.appendChild(document.createElement('br'));
			div.appendChild(create_text("This&nbsp;"));
			div.appendChild(create_text("meta",{fontStyle:'italic'}));
			div.appendChild(create_text("-game connects the two...&nbsp;"));
			div.appendChild(create_anchor("Cool! Let's play!", function() {
				div.parentNode.removeChild(div);
				connect_to_server();
			}));
			slide_anim(div, true);
		});
	}));
	div.appendChild(create_text('&nbsp;'));
	div.appendChild(create_anchor("What's Ludum Dare?", function() {
		slide_anim(div, false, function() {
			while(div.firstChild) div.removeChild(div.firstChild);
			div.appendChild(create_text("You have to have played Ludum Dare 30 in order to be able to play this game.&nbsp;"));
			div.appendChild(create_anchor("show me Ludum Dare!", function() {
				report_info("user doesn't play LD");
				window.location = "http://www.ludumdare.com/compo";
			}));
			slide_anim(div, true);
		});
	}));
	document.body.appendChild(div);
	slide_anim(div, true, function() {
		loadFile("image", "data/map1.jpg", update_ctx);
		world_map.mask = make_mask(null,null,0xff994c19);
	});
}

function prompt_guess_username(lng,lat) {
	var candidates = nearest_users(lng,lat);
	if(candidates[0][0] > 300) { //KM
		go_to(lat,lng,0.3);
		user.position = [lng,lat];
		prompt_for_username("Unfortunately, the nearest known user is currently " + 
			candidates[0][0].toFixed(0) + "km away, so lets get you connected ASAP!");
		return;
	}
	user = candidates[0][1];
	go_to(user.position[1], user.position[0],0.3);	
}

function prompt_position(greeting) {
	var div = document.createElement("div");
	div.className = "bottom";
	if(greeting) {
		div.appendChild(create_text("Welcome " + greeting + "!"));
		div.appendChild(document.createElement('br'));
	}
	div.appendChild(create_text("Please click on the map to set your position in the&nbsp;"));
	div.appendChild(create_text("real",{fontStyle:'italic'}));
	div.appendChild(create_text("&nbsp;world...&nbsp;"));
	if(!user.position && ip_pos) {
		console.log("setting position from ip guess");
		var x = ip_pos[7], y = ip_pos[6];
		user.position = [y  * DEG2RAD, x * DEG2RAD];
	}
	var ok_button = create_anchor("My location's ok!", function() {
			slide_anim(div, false, function() {
					div.parentNode.removeChild(div);
					window.onMouseDown = properOnMouseDown;
					prompt_explain();
			});
		});
	div.appendChild(ok_button);
	if(user.position)
		go_to(user.position[1], user.position[0], 0.3);
	else
		ok_button.style.display = "none";
	document.body.appendChild(div);
	var properOnMouseDown = window.onMouseDown;
	slide_anim(div, true, function() {
		window.onMouseDown = function(evt) {
			var pos = unproject(evt.clientX, canvas.height-evt.clientY, world_map.mvpMatrix, mat4_identity, [0,0,canvas.width,canvas.height])[0];
			prompt_guess_username(pos[1], pos[0]);
			slide_anim(div, false, function() { div.parentNode.removeChild(div); });
			/*
			go_to(pos[0], pos[1], 0.3);
			user.position = [pos[1],pos[0]];
			ok_button.style.display = "inline";
			*/
		};
		canvas.focus();
	});
}

function prompt_unknown_user(user) {
	var div = document.createElement('div');
	div.className = "bottom";
	div.appendChild(create_text("Sorry, we don't know a user " + user));
	div.appendChild(document.createElement('br'));
	var msg = "(You need to have entered LD 30";
	if(parseInt(user) != user) msg += "; and we can better resolve IDs than names";
	if(now() < Date.UTC(2014,7,26,1))
		msg += "; or maybe you've just entered, and my scraper hasn't noticed yet? "+
			"In which case, its just to wait a while";
	div.appendChild(create_text(msg + ")",{color:'pink'}));
	div.appendChild(create_anchor("OK :(", function() {
			slide_anim(div, false, function() {
					div.parentNode.removeChild(div);
					prompt_for_username();
			});
	}));
	document.body.appendChild(div);
	slide_anim(div, true);
}

function prompt_for_username(msg) {
	var lookup = function() {
		var val = uid.value.trim();
		if(val) {
			var is_uid = val == parseInt(val);
			slide_anim(div, false, function() {
				div.parentNode.removeChild(div);
				var msg = { cmd: "get_user", token:"guess" };
				if(val == parseInt(val))
					msg.uid = parseInt(val);
				else
					msg.username = val;
				server_websocket.send(JSON.stringify(msg));
			});
		} else
			uid.focus();
	};
	var div = document.createElement('div');
	div.className = "bottom";
	if(msg) {
		div.appendChild(create_text(msg));
		div.appendChild(document.createElement('br'));
	}
	div.appendChild(create_text("What's your Ludum Dare user name or ID?&nbsp;"));
	var uid = document.createElement('input');
	uid.addEventListener('keyup',function(evt) { if(evt.keyCode == 13) lookup(); });
	uid.style.fontSize = 'large';
	div.appendChild(uid);
	div.appendChild(create_anchor("OK!", function() { lookup(); }));
	div.appendChild(document.createElement('br'));
	div.appendChild(create_text("(Ludum Dare IDs are numeric; you can see yours in your Game Entry URLs)",{color:'pink'}));
	document.body.appendChild(div);
	slide_anim(div, true, function() {
		uid.focus();
	});	
}

function prompt_for_user() {
	var div = document.createElement('div');
	div.className = "bottom";
	canvas.focus();
	if(ip_pos && ip_pos[2]) {
		div.appendChild(create_text("Are you in "+ip_pos[2][4] + "?&nbsp;"));
		div.appendChild(create_anchor("Yes, good guess!", function() {
			slide_anim(div, false, function() {
				div.parentNode.removeChild(div);
				prompt_guess_username(ip_pos[6]*DEG2RAD,ip_pos[7]*DEG2RAD);
			});
		}));
		div.appendChild(create_text('&nbsp;'));
		div.appendChild(create_anchor("Ha Ha not even close!", function() {
			slide_anim(div, false, function() {
				div.parentNode.removeChild(div);
				prompt_position();
			});
		}));
	} else {
		div.appendChild(create_text("Hmm, I don't who you are!  Can you help me?"));
		div.appendChild(create_anchor("OK!", function() {
			slide_anim(div, false, function() {
				div.parentNode.removeChild(div);
				prompt_position();
			});
		}));
	}
	document.body.appendChild(div);
	slide_anim(div, true);
}
