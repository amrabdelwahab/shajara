"""Import a set list (Marawan's concert set list artifact data) into a Shajara space as a set.
usage: python3 tools/import-set.py <api base> <space passcode> <member id of the importer> <set json> [set name]
Each song becomes a track written for the set: sections (with what happens and how long it feels), the line-up per section
(who, which layer, on what, playing what), production lanes, and the cues. Layers are guessed from the part names;
the band can change any of it in the app afterwards."""
import json, sys, urllib.request
API, KEY, ME, SRC = sys.argv[1:5]
NAME = sys.argv[5] if len(sys.argv) > 5 else "Next concert"
d = json.load(open(SRC))
def call(method, path, body=None):
    req = urllib.request.Request(API + "/api" + path, method=method, data=json.dumps(body).encode() if body is not None else None,
        headers={"X-Band-Key": KEY, "X-Member": ME, "Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r: return json.loads(r.read())
state = call("GET", "/state")
by_name = {m["name"].lower(): m["id"] for m in state["members"]}
def member(who):
    name = d["PLAYERS"][who]["name"]
    for k, v in by_name.items():
        if k == name.lower() or (name.lower().startswith("mar") and k.startswith("mar")): return v
    m = call("POST", "/members", {"name": name, "guest": True, "instruments": d["PLAYERS"][who]["role"]})
    by_name[name.lower()] = m["id"]; return m["id"]
PEOPLE = {w: member(w) for w in d["PLAYERS"] if w != "ableton"}
ROLE = {w: d["PLAYERS"][w]["role"] for w in d["PLAYERS"]}
def layer_for(who, what, tone):
    t = (what + " " + tone).lower()
    if any(k in t for k in ["solo", "melody", "taqsim", "theme", "line", "improv", "conversation", "respond", "lyrical", "joins", "accents"]): return "bloom"
    if "launches drums" in t or "builds drums" in t: return "substrate"
    if "plays samples" in t: return "ground"
    if "rhythm" in t: return "bark"
    if any(k in t for k in ["chord", "voicing", "pad", "accompan", "choir", "strings", "piano", "texture", "ii v i"]): return "bark"
    return {"amr": "bloom", "sherif": "bark", "marawan": "bark"}.get(who, "bloom")
# Production holds substrate (pads, drums) and ground (samples); players alternate between bark and bloom.
PROD_LAYER = {"Pads": "substrate", "Drums": "substrate", "Samples": "ground", "Ending": "ground", "Ambience": "substrate"}
st = call("POST", "/sets", {"name": NAME, "people": list(PEOPLE.values()), "notes": "Imported from Marawan's set list. Section lengths are relative until we have bar counts."})
print("set", st["id"], NAME)
for song in d["SONGS"]:
    secs = song["sections"]
    t = call("POST", "/tracks", {"title": song["title"], "notes": d["BLURBS"].get(song["title"], ""), "set_id": st["id"],
                                 "sections": [{"name": s["name"], "notes": s.get("sub", "")} for s in secs]})
    sids = [s["id"] for s in t["sections"]]
    for i, sid in enumerate(sids):
        holders, prod = {}, {}
        for lane in song["lanes"]:
            for b in lane["blocks"]:
                lo, hi = int(b["s"]), max(int(b["s"]) + 1, -(-b["e"] // 1))
                if not (lo <= i < hi): continue
                part = b["what"] + (" · " + b["tone"] if b.get("tone") else "")
                if lane["who"] == "ableton":
                    L = PROD_LAYER.get(lane["label"], "ground")
                    x = prod.setdefault(L, {"instrument": [], "part": []})
                    if lane["label"] not in x["instrument"]: x["instrument"].append(lane["label"])
                    if part not in x["part"]: x["part"].append(part)
                else:
                    x = holders.setdefault(lane["who"], {"layer": layer_for(lane["who"], b["what"], b.get("tone", "")), "part": []})
                    if part not in x["part"]: x["part"].append(part)
        lineup = [{"member_id": PEOPLE[w], "layer": x["layer"], "instrument": ROLE[w], "part": " / ".join(x["part"])[:120]} for w, x in holders.items()]
        lineup += [{"member_id": "production", "layer": L, "instrument": " + ".join(x["instrument"])[:60], "part": " / ".join(x["part"])[:120]} for L, x in prod.items()]
        call("PUT", f"/sections/{sid}/lineup", {"holders": lineup})
        cues = [{"text": c["text"], "from": "production" if any(k in c["text"].lower() for k in ["sample", "pad", "drum", "organ", "loop", "backing", "ending", "track"]) else PEOPLE.get("marawan", "production")}
                for c in song.get("cues", []) if int(c["at"]) == i]
        call("PATCH", f"/sections/{sid}", {"weight": secs[i].get("w") or 1, "cues": cues})
    print(" ", song["title"], len(sids), "sections")
print("done; future songs (not imported):", ", ".join(d.get("LATER", [])))
