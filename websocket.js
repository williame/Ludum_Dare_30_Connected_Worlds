
function create_websocket_connection(handler, ws_path) {
	if(!ws_path)
		ws_path = getParameterByName("server");
	if(!ws_path) {
		if(isLocalHost()) // if running locally, connect locally
			ws_path = window.location.host;
		else
			ws_path = "31.192.226.244:28283"; // my private server; if you fork, you have to change this
	}
	ws_path = "ws://"+ws_path+"/ws-ld30";
	ws = new WebSocket(ws_path);
	ws.onopen = function() {
		console.log("websocket",ws_path,"open");
	};
	ws.onclose = function() {
		console.log("websocket",ws_path,"closed");
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
