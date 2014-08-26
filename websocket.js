
function create_websocket_connection(handler, ws_host) {
	if(!ws_host)
		ws_host = getServerHost();
	var ws_path = "ws://"+ws_host+"/ws-ld30";
	var ws = new WebSocket(ws_path);
	var real_send = ws.send;
	var queued_send = [];
	var queue_send = function() {
		queued_send.push(Array.prototype.slice.call(arguments, 0));
		console.log("queue_send:", ws.readyState);
		if(ws.readyState == 3) {
			server_websocket = create_websocket_connection(handler, ws_host);
			for(var i in queued_send)
				server_websocket.send.apply(server_websocket, queued_send[i]);
		}
	};
	ws.send = queue_send;
	ws.onopen = function() {
		console.log("websocket",ws_path,"open");
		ws.send = real_send;
		for(var i in queued_send)
			real_send.apply(ws, queued_send[i]);
		queued_send = [];
	};
	ws.onclose = function() {
		console.log("websocket",ws_path,"closed");
		ws.send = queue_send;
	};
	ws.error = function(e) {
		if(e && e.message) e = e.message;
		console.log("websocket",ws_path,"encountered an error:",e);
		UI.addMessage(6,ws_path,"encountered a network problem: "+e);
		ws.close();
	};
	ws.onerror = ws.error;
	ws.onmessage = function(evt) {
		try {
			handler(evt);
		} catch(e) {
			console.log("WebSocket ERROR",e);
			ws.error(e);
		}
	};
	return ws;
}
