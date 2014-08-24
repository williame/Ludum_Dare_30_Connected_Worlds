
function create_websocket_connection(handler, ws_path) {
	if(!ws_path)
		ws_path = getServerHost();
	ws_path = "ws://"+ws_path+"/ws-ld30";
	ws = new WebSocket(ws_path);
	var real_send = ws.send;
	var queued_send = [];
	var queue_send = function() {
		queued_send.push(Array.prototype.slice.call(arguments, 0));
	};
	ws.send = queue_send;
	ws.onopen = function() {
		console.log("websocket",ws_path,"open");
		ws.send = real_send;
		for(var i in queued_send)
			real_send.apply(ws, queued_send[i]);
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
