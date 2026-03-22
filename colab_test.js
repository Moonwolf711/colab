var inlets = 1;
var outlets = 1;

function bang() {
  post("coLaB: bang works!\n");
}

function init() {
  post("coLaB: init works!\n");
  post("coLaB: reading tracks...\n");
  var ls = new LiveAPI("live_set");
  var count = ls.getcount("tracks");
  post("coLaB: found " + count + " tracks\n");
  for (var i = 0; i < count; i++) {
    var t = new LiveAPI("live_set tracks " + i);
    post("  Track " + i + ": " + t.get("name") + "\n");
  }
  post("coLaB: done!\n");
}

post("coLaB test script loaded.\n");
