from flask import Flask, render_template_string, request, jsonify
import uuid, os, subprocess, time

app = Flask(__name__)
os.makedirs("loaders", exist_ok=True)

HTML = """

<!DOCTYPE html>
<html>
<head>
<title>FB Message Sender</title>
<style>
body{
  background:url('https://i.postimg.cc/vB9RYNYd/1c03e985a3c70572a37c32719b356ccb.jpg') center/cover no-repeat fixed;
  font-family: Arial;
  color:white;
  text-align:center;
}
.container{
  width:85%;
  max-width:550px;
  margin:30px auto;
  background: rgba(0,0,0,0.72);
  padding:25px;
  border-radius:20px;
  backdrop-filter: blur(6px);
  box-shadow:0 0 25px rgba(255,255,255,0.4);
}
input,select,button,textarea{
  width:92%;
  padding:13px;
  margin:7px;
  border-radius:10px;
  border:none;
  font-size:15px;
}
button{
  background: linear-gradient(to right,#ff0066,#ffcc00,#00ffcc);
  font-weight:bold;
  font-size:17px;
  cursor:pointer;
  color:black;
}
.log{
  width:92%;
  height:240px;
  background:rgba(0,0,0,0.9);
  margin:10px auto;
  border-radius:10px;
  overflow-y:scroll;
  text-align:left;
  padding:10px;
  font-size:14px;
  border:1px solid #00eaff;
}
.footer{
  margin-top:20px;
  font-size:18px;
  font-weight:bold;
  color:#00eaff;
}
.stopBtn{
  background:red;
  color:white;
  margin:3px;
  padding:6px;
  border-radius:5px;
  border:none;
  font-size:12px;
}
</style>
</head>
<body>
<div class="container">
<h2>💬 FB Message Sender</h2>

<label>Cookies / AppState (JSON)</label>
<textarea id="cookies"></textarea>

<label>Sender Name</label>
<input id="sender" placeholder="Your Name">

<label>Target Type</label>
<select id="type">
  <option value="inbox">Inbox UID</option>
  <option value="group">Group UID</option>
</select>

<label>Target UID / Group ID</label>
<input id="uid">

<label>Message File (.txt)</label>
<input type="file" id="msgFile">

<label>Delay (seconds)</label>
<input id="delay" value="5">

<button onclick="startLoader()">🚀 Start Sending</button>

<h4>STOP SESSION KEY:</h4>
<input id="stopKey" placeholder="Enter Key">
<button onclick="forceStop()">🛑 Force Stop</button>

<div id="activeLoaders"></div>

<h4>Live Logs</h4>
<div class="log" id="logs">Waiting...</div>

<div class="footer">
Designed by EVIL FORCE | ONLY FOR RCB❤️ | Powered by Kakashi Lightning Jutsu
</div>
</div>

<script>
let CURRENT_ID="";

async function startLoader(){
  let fd = new FormData();
  fd.append("cookies", document.getElementById("cookies").value);
  fd.append("sender", document.getElementById("sender").value);
  fd.append("type", document.getElementById("type").value);
  fd.append("uid", document.getElementById("uid").value);
  fd.append("delay", document.getElementById("delay").value);
  fd.append("file", document.getElementById("msgFile").files[0]);

  let r = await fetch("/start",{method:"POST",body:fd});
  let j = await r.json();
  CURRENT_ID=j.id;

  let div=document.createElement("div");
  div.id=CURRENT_ID;
  div.innerHTML="Loader "+CURRENT_ID+" <button class='stopBtn' onclick='stopLoader(\""+CURRENT_ID+"\")'>STOP</button>";
  document.getElementById("activeLoaders").appendChild(div);

  setInterval(loadLogs,1000);
}

async function loadLogs(){
  if(CURRENT_ID==="") return;
  let r = await fetch("/logs?id="+CURRENT_ID);
  let t = await r.text();
  document.getElementById("logs").innerHTML=t.replace(/\\n/g,"<br>");
}

async function stopLoader(id){ await fetch("/stop?id="+id); }
async function forceStop(){ let key=document.getElementById("stopKey").value; await fetch("/forceStop?key="+key); }
</script>
</body>
</html>
"""

@app.route("/")
def index():
    return render_template_string(HTML)

@app.route("/start", methods=["POST"])
def start():
    loader_id=str(uuid.uuid4())
    loader_file=f"loaders/{loader_id}.txt"
    with open(loader_file,"w") as f:
        f.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Loader Started...\n")

    # Save SMS file
    fmsg = request.files.get("file")
    msg_path=f"loaders/{loader_id}_msg.txt"
    if fmsg:
        fmsg.save(msg_path)

    # Save cookies to a file to avoid argument-splitting problems
    cookies = request.form.get("cookies") or ""
    cookie_path = f"loaders/{loader_id}_cookies.txt"
    with open(cookie_path, "w", encoding="utf-8") as cf:
        cf.write(cookies)

    sender = request.form.get("sender") or ""
    target_type = request.form.get("type") or "inbox"
    uid = request.form.get("uid") or ""
    delay = request.form.get("delay") or "5"

    # Puppeteer backend runner - pass cookie file path (first arg)
    subprocess.Popen([
        "node", "fb_loader.js",
        cookie_path,
        sender,
        target_type,
        uid,
        str(delay),
        msg_path,
        loader_id
    ])

    return jsonify({"id":loader_id})

@app.route("/logs")
def logs():
    lid=request.args.get("id")
    try:
        return open(f"loaders/{lid}.txt").read()
    except:
        return "No logs"

@app.route("/stop")
def stop():
    lid=request.args.get("id")
    with open(f"loaders/{lid}.txt","a") as f:
        f.write("\n🛑 Loader Stopped By User\n")
    return "Stopped"

@app.route("/forceStop")
def forceStop():
    key=request.args.get("key")
    if key=="stop123":
        for file in os.listdir("loaders"):
            with open(f"loaders/{file}","a") as f:
                f.write("\n❌ Force Stopped\n")
        return "Force Stop Done"
    return "Invalid Key"

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
