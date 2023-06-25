let diagram = undefined;
let diag_x, diag_y;
const deps_input = document.querySelector("#deps");
deps_input.addEventListener("input", run);
const elem_graph = document.querySelector("#graph");
const render_debounced = debounce(render, 100);
const source_mode = document.querySelector("#source_mode");
source_mode.onchange = () => display_source_mode();
const elem_sync_url = document.querySelector("#sync_url");
elem_sync_url.onchange = () => update_base_url();
const elem_sync_iframe = document.querySelector("#sync_iframe");
let last_text = undefined;
let poll_timer = undefined;
let base_poll_url = undefined;
const vgoal = "<goal>";
function run() {
    if (last_text == deps_input.value) {
        return;
    }
    last_text = deps_input.value;
    let ctx = parse(deps_input.value);
    get_flat_list(ctx);
    build_diagram(ctx);
    render_debounced();
}
function display_source_mode() {
    const mode = source_mode.value;
    document.querySelector("#panel_local").style.display = mode == "local" ? "" : "none";
    document.querySelector("#panel_sync").style.display = mode == "sync" ? "" : "none";
    if (mode == "sync") {
        poll_timer = setInterval(poll_sync, 1000);
    }
    else {
        clearInterval(poll_timer);
    }
}
async function poll_sync() {
    const url = base_poll_url + "/download";
    try {
        const req = await fetch(url);
        const text = await req.text();
        deps_input.value = text;
        run();
    }
    catch (e) {
        console.log("poll_sync error", e);
        return;
    }
}
function update_base_url() {
    const url = elem_sync_url.value;
    if (url == "") {
        return;
    }
    const hash = url.indexOf("#");
    if (hash != -1) {
        url = url.substring(0, hash);
    }
    const query = url.indexOf("?");
    if (query != -1) {
        url = url.substring(0, query);
    }
    while (url.endsWith("/")) {
        url = url.substring(0, url.length - 1);
    }
    base_poll_url = url;
    elem_sync_iframe.src = base_poll_url + "?edit";
    display_source_mode();
}
function parse(input) {
    const ctx = {
        deps: new Map(),
        counts: new Map(),
    };
    ctx.counts.set(vgoal, 1);
    function addDeps(target, ingrid, count) {
        let deplist = ctx.deps.get(target);
        if (deplist == undefined) {
            deplist = new Map();
            ctx.deps.set(target, deplist);
        }
        let existing = deplist.get(ingrid) || 0;
        deplist.set(ingrid, existing + count);
    }
    const lines = input.split("\n");
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const matchRule = line.match(/^\s*((?<TargetCount>[\d\.]+)\s*\*\s*)?(?<Target>\w+)\s*<-?\s*((?<IngridCount>[\d\.]+)\s*\*\s*)?(?<Ingrid>\w+)/);
        if (matchRule) {
            let target = matchRule.groups.Target;
            let count = NumOr1(matchRule.groups.IngridCount) / NumOr1(matchRule.groups.TargetCount);
            let ingrid = matchRule.groups.Ingrid;
            addDeps(target, ingrid, count);
            continue;
        }
        const matchStart = line.match(/^\s*=\s*((?<TargetCount>[\d\.]+)\s*\*\s*)?(?<Target>\w+)/);
        if (matchStart) {
            let target = matchStart.groups.Target;
            let count = NumOr1(matchStart.groups.TargetCount);
            addDeps(vgoal, target, count);
            continue;
        }
        const matchSub = line.match(/^\s*-\s*((?<TargetCount>[\d\.]+)\s*\*\s*)?(?<Target>\w+)/);
        if (matchSub) {
            let target = matchSub.groups.Target;
            let count = matchSub.groups.TargetCount;
            count = Number(count);
            if (isNaN(count)) {
                continue;
            }
            let existing = ctx.counts.get(target) || 0;
            ctx.counts.set(target, existing - count);
            continue;
        }
    }
    // console.log(deps);
    return ctx;
}
function get_flat_list(ctx) {
    const g = new graphlib.Graph({ multigraph: false, compound: false });
    for (const [target, deplist] of ctx.deps) {
        for (const [ingrid, count] of deplist) {
            g.setEdge(target, ingrid);
        }
    }
    let toplist = graphlib.alg.topsort(g);
    // console.log(toplist);
    for (let group of graphlib.alg.components(g)) {
        if (group.includes(vgoal)) {
            group = new Set(group);
            ctx.group = group;
            toplist = toplist.filter((x) => group.has(x));
            break;
        }
    }
    ctx.group = ctx.group ?? new Set();
    // console.log(toplist);
    for (let item of toplist) {
        const itemdeps = ctx.deps.get(item);
        if (itemdeps == undefined) {
            continue;
        }
        let selfcount = Math.max(ctx.counts.get(item) || 0, 0);
        for (const [ingrid, count] of itemdeps) {
            const existing = ctx.counts.get(ingrid) || 0;
            ctx.counts.set(ingrid, existing + selfcount * count);
        }
    }
}
function build_diagram(ctx) {
    let digraph = "digraph {\n";
    console.log(ctx);
    for (const [ingrid, count] of ctx.counts) {
        if (count <= 0 || ingrid == vgoal) {
            continue;
        }
        const countRound = Math.ceil(count);
        digraph += `  ${ingrid} [label="${ingrid} (${countRound})"];\n`;
    }
    digraph += "\n";
    for (const [target, deplist] of ctx.deps) {
        const targetCount = (ctx.counts.get(target) || 0);
        if (targetCount <= 0 || target == vgoal) {
            continue;
        }
        for (const [ingrid, count] of deplist) {
            if ((ctx.counts.get(ingrid) || 0) <= 0) {
                continue;
            }
            const partCount = targetCount * count;
            const countRound = parseFloat(partCount.toFixed(2));
            digraph += `  ${ingrid} -> ${target} [label="${countRound}"];\n`;
        }
    }
    digraph += "}";
    //console.log(digraph);
    diagram = digraph;
}
function render() {
    if (diagram == undefined) {
        return;
    }
    d3.select("#graph")
        .graphviz({
        width: "100%",
        height: "100%",
        fit: true,
    })
        .renderDot(diagram);
}
function debounce(func, timeout = 300) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => { func.apply(this, args); }, timeout);
    };
}
function NumOr1(val) {
    const num = Number(val);
    if (isNaN(num)) {
        return 1;
    }
    return num;
}
update_base_url();
display_source_mode();
run();
