function create_anchor(title, callback) {
	var a = document.createElement('a');
	a.appendChild(create_text(title));
	a.addEventListener('click',callback);
	return a;
}

function create_button(img, callback, tooltip) {
	var btn = document.createElement('img');
	btn.src = img;
	btn.addEventListener('click',callback);
	btn.title = tooltip;
	return btn;
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

function onUserClick(user) {
	var div = document.createElement('div');
	div.className = 'middle';
	div.appendChild(create_text(user.name));
	div.appendChild(document.createElement('br'));
	var thumb = document.createElement('img');
	thumb.src = user.img;
	div.appendChild(thumb);
	div.appendChild(document.createElement('br'));
	for(var t in user.targets)
		div.appendChild(create_text((t? ", ": "") + user.targets[t][1]));
	div.appendChild(document.createElement('br'));
	var play = document.createElement('a');
	play.appendChild(create_text("Play and comment!"));
	play.href = "http://www.ludumdare.com/compo/ludum-dare-30/?action=preview&uid=" + user.uid;
	play.target = "_blank";
	div.appendChild(play);
	var properMouseDown = window.onMouseDown;
	var dismiss = window.onMouseDown = function() {
			div.parentNode.removeChild(div);
			window.onMouseDown = properMouseDown;
			canvas.focus();
			return true;
	};
	play.addEventListener('click',dismiss);
	document.body.appendChild(div);
	div.focus();
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
		loadFile("image", "data/map1.png", update_ctx);
	});
}

function toolbar() {
	var div = document.createElement('div');
	div.className = 'bottom';
	div.style.textAlign = 'right';
	canvas.focus();
	var refresh_count = 0;
	div.appendChild(create_button("data/button_refresh.png", function() {
			if(refresh_count++ % 3 == 2)
				alert("We SCRAPE the Ludum Dare site, and we don't want\n" +
					"to put it under any load, so we only do it a few times\n"+
					"an hour. Be patient, and check back in a short while!");
			server_websocket.send(JSON.stringify({
				cmd: "get_users",
				seq: server_websocket.seq,
			}));
			canvas.focus();
	}, "reload (use sparingly!)"));
	div.appendChild(create_button("data/button_me.png", function() {
			go_to(user.position.to_mercator(),0.3);
			canvas.focus();
	}, "back to me"));
	div.appendChild(create_button("data/button_zoom_out.png", function() {
			go_to([0,0],100);
			canvas.focus();
	}, "zoom out"));
	div.lastChild.style.marginRight = "40px";
	document.body.appendChild(div);
	slide_anim(div, true);
}

function user_ready() {
	world_map.mask = make_mask(user.uid, world_map.mask);
	go_to(user.position.to_mercator(),0.3);
	canvas.focus();
	server_websocket.send(JSON.stringify({
			"cmd":"get_comments",
			"seq":server_websocket.seq,
			"uid":user.uid,
	}));
	var div = document.createElement('div');
	div.className = 'bottom';
	div.appendChild(create_text("Every time you&nbsp;"));
	div.appendChild(create_text("comment",{fontStyle:'italic',color:'pink'}));
	div.appendChild(create_text("&nbsp;on an entry, you expose a bit more of the map!"));
	div.appendChild(document.createElement('br'));
	div.appendChild(create_text("And when other users comment on your entry, they expose a bit more of the map for you too!"));
	div.appendChild(document.createElement('br'));
	div.appendChild(create_text("Play entries from far afield, leave a comment, and connect the world!&nbsp;"));
	div.appendChild(create_anchor("OK", function() {
			slide_anim(div, false, function() {
					div.parentNode.removeChild(div);
					toolbar();
			});
	}));
	document.body.appendChild(div);
	slide_anim(div, true);
}

function prompt_guess_username(position) {
	var candidates = nearest_users(position);
	if(candidates[0][0] > 100) { //KM
		go_to(position.to_mercator(),0.3);
		user.position = position;
		prompt_for_username("Unfortunately, the nearest known user is currently " + 
			candidates[0][0].toFixed(0) + "km away, so lets get you connected ASAP!");
		return;
	}
	console.log("guessing",position,"->",candidates[0]);
	user = candidates[0][1];
	go_to(user.position.to_mercator(),0.3);
	var div = document.createElement("div");
	div.className = "bottom";
	var question = document.createElement('span');
	question.appendChild(create_text("Are you " + user.name + "?&nbsp;"))
	div.appendChild(question);
	div.appendChild(create_anchor("Yes!",function() {
		slide_anim(div, false, function() {
			div.parentNode.removeChild(div);
			window.onUserClick = old_onUserClick;
			user_ready();
		});
	}));
	div.appendChild(create_anchor("No :(  Let me enter it manually", function() { 
		slide_anim(div, false, function() {
			div.parentNode.removeChild(div);
			window.onUserClick = old_onUserClick;
			prompt_for_username();
		});
	}));
	div.appendChild(document.createElement('br'));
	div.appendChild(create_text("&nbsp;(You can also just look around the map and find yourself that way)", {color:'pink'}));
	document.body.appendChild(div);
	var old_onUserClick = window.onUserClick;
	slide_anim(div, true, function() {
		canvas.focus();
		window.onUserClick = function(u) {
			while(question.firstChild) question.removeChild(question.firstChild);
			user = u;
			go_to(user.position.to_mercator());
			question.appendChild(create_text("Are you " + user.name + "?&nbsp;"));
		};
	});
	update_ctx();
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
		user.position = new LatLng(ip_pos[6], ip_pos[7]);
	}
	var ok_button = create_anchor("My location's ok!", function() {
			slide_anim(div, false, function() {
					div.parentNode.removeChild(div);
					window.onMouseDown = properOnMouseDown;
					if(user.uid) {
						server_websocket.send(JSON.stringify({
								"cmd":"set_location",
								"uid":user.uid,
								"position":[user.position.lat,user.position.lng],
						}));
						user_ready();
					} else
						prompt_for_username();
			});
		});
	div.appendChild(ok_button);
	if(user.position)
		go_to(user.position.to_mercator(),0.3);
	else
		ok_button.style.display = "none";
	document.body.appendChild(div);
	var properOnMouseDown = window.onMouseDown;
	slide_anim(div, true, function() {
		window.onMouseDown = function(evt) {
			var mercator = unproject(evt.clientX, canvas.height-evt.clientY, 
				world_map.mvpMatrix, mat4_identity,
				[0,0,canvas.width,canvas.height])[0];
			var latlng = LatLng.from_mercator(mercator);
			if(!user.uid) {
				window.onMouseDown = properOnMouseDown;
				prompt_guess_username(latlng);
				slide_anim(div, false, function() { div.parentNode.removeChild(div); });
			} else {
				go_to(mercator, 0.3);
				user.position = latlng;
				ok_button.style.display = "inline";
			}
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
			window.onUserClick = old_onUserClick;
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
	if(user.username)
		uid.value = user.username;
	div.appendChild(uid);
	div.appendChild(create_anchor("OK!", function() { lookup(); }));
	div.appendChild(document.createElement('br'));
	div.appendChild(create_text("(Ludum Dare IDs are numeric; you can see yours in your Game Entry URLs)",{color:'pink'}));
	document.body.appendChild(div);
	var old_onUserClick = window.onUserClick;
	slide_anim(div, true, function() {
		uid.focus();
		window.onUserClick = function(u) {
			uid.value = u.username;
			user = u;
			update_ctx();
		};
	});
}

function prompt_for_user() {
	if(!ip_pos || !ip_pos[2]) {
		prompt_position("Hmm, I don't who you are!  Can you help me?");
		return;
	}
	var div = document.createElement('div');
	div.className = "bottom";
	canvas.focus();
	div.appendChild(create_text("Are you in "+ip_pos[2][4] + "?&nbsp;"));
	div.appendChild(create_anchor("Yes, good guess!", function() {
		slide_anim(div, false, function() {
			div.parentNode.removeChild(div);
			prompt_guess_username(new LatLng(ip_pos[6],ip_pos[7]));
		});
	}));
	div.appendChild(create_text('&nbsp;'));
	div.appendChild(create_anchor("Ha Ha not even close!", function() {
		slide_anim(div, false, function() {
			div.parentNode.removeChild(div);
			prompt_position();
		});
	}));
	document.body.appendChild(div);
	slide_anim(div, true);
}
