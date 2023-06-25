let diagram: string | undefined = undefined;
let diag_x, diag_y;
const deps_input = document.querySelector<HTMLTextAreaElement>("#deps")!;
deps_input.addEventListener("input", run);
const elem_graph = document.querySelector<HTMLDivElement>("#graph")!;
const render_debounced = debounce(render, 100);
const source_mode = document.querySelector<HTMLSelectElement>("#source_mode")!;
source_mode.onchange = () => display_source_mode();
const elem_sync_url = document.querySelector<HTMLInputElement>("#sync_url")!;
elem_sync_url.onchange = () => update_base_url();
const elem_sync_iframe = document.querySelector<HTMLIFrameElement>("#sync_iframe");
let last_text: string | undefined = undefined;
let poll_timer: ReturnType<typeof setTimeout> | undefined = undefined;
let base_poll_url: string | undefined = undefined;

const vgoal = "<goal>";

interface GraphCtx {
	deps: Map<string, RecepieRequirements>;
	counts: Map<string, number>;
	group?: Set<string>;
}

interface RecepieRequirements {
	count_target: number;
	ingredients: Map<string, number>;
}

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
	document.querySelector<HTMLDivElement>("#panel_local").style.display = mode == "local" ? "" : "none";
	document.querySelector<HTMLDivElement>("#panel_sync").style.display = mode == "sync" ? "" : "none";

	if (mode == "sync") {
		poll_timer = setInterval(poll_sync, 1000);
	} else {
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
	} catch (e) {
		console.log("poll_sync error", e);
		return;
	}
}

function update_base_url() {
	let url = elem_sync_url.value;
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

function parse(input: string) {
	const ctx: GraphCtx = {
		deps: new Map<string, RecepieRequirements>(),
		counts: new Map<string, number>(),
	};
	ctx.counts.set(vgoal, 1);

	function addDeps(target: string, ingrid: string, count_target: number, count_ingrid: number) {
		let deplist = ctx.deps.get(target);
		if (deplist == undefined) {
			deplist = {
				count_target,
				ingredients: new Map(),
			}
			ctx.deps.set(target, deplist);
		}

		let existing = deplist.ingredients.get(ingrid) || 0;
		deplist.ingredients.set(ingrid, existing + count_ingrid);
	}

	const lines = input.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		const matchRule = line.match(/^\s*((?<TargetCount>[\d\.]+)\s*\*\s*)?(?<Target>\w+)\s*<-?\s*((?<IngridCount>[\d\.]+)\s*\*\s*)?(?<Ingrid>\w+)/);
		if (matchRule) {
			let target = matchRule.groups.Target;
			let count_ingrid = NumOr1(matchRule.groups.IngridCount);
			let count_target = NumOr1(matchRule.groups.TargetCount);
			let ingrid = matchRule.groups.Ingrid;

			addDeps(target, ingrid, count_target, count_ingrid);
			continue;
		}

		const matchStart = line.match(/^\s*=\s*((?<TargetCount>[\d\.]+)\s*\*\s*)?(?<Target>\w+)/);
		if (matchStart) {
			let target = matchStart.groups.Target;
			let count = NumOr1(matchStart.groups.TargetCount);

			addDeps(vgoal, target, 1, count);
			continue;
		}

		const matchSub = line.match(/^\s*-\s*((?<TargetCount>[\d\.]+)\s*\*\s*)?(?<Target>\w+)/);
		if (matchSub) {
			let target = matchSub.groups.Target;
			let count: number | string = matchSub.groups.TargetCount;

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

function get_flat_list(ctx: GraphCtx) {
	const g = new graphlib.Graph({ multigraph: false, compound: false });

	for (const [target, recipe] of ctx.deps) {
		for (const [ingrid, count] of recipe.ingredients) {
			g.setEdge(target, ingrid);
		}
	}

	let toplist: string[] = graphlib.alg.topsort(g);
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
		const recipe = ctx.deps.get(item);
		if (recipe == undefined) {
			continue;
		}

		let selfcount = Math.max(ctx.counts.get(item) || 0, 0);
		selfcount = RoundToSmallestMultiple(selfcount, recipe.count_target);
		ctx.counts.set(item, selfcount);

		for (const [ingrid, count] of recipe.ingredients) {
			const existing = ctx.counts.get(ingrid) || 0;
			ctx.counts.set(ingrid, existing + selfcount * (count / recipe.count_target));
		}
	}
}

function build_diagram(ctx: GraphCtx) {
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

		for (const [ingrid, count] of deplist.ingredients) {
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

function debounce(func: Function, timeout = 300) {
	let timer: undefined | number;
	return (...args: any[]) => {
		clearTimeout(timer);
		timer = setTimeout(() => { func.apply(this, args); }, timeout);
	};
}

function NumOr1(val: string | number | undefined) {
	const num = Number(val);
	if (isNaN(num)) {
		return 1;
	}
	return num;
}

function RoundToSmallestMultiple(val: number, multiple: number) {
	return Math.ceil(val / multiple) * multiple;
}

update_base_url();
display_source_mode();
run();
