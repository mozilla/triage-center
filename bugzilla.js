"use strict";

const API_BASE = "https://bugzilla.mozilla.org/rest/";

// populated by get_versions()
let FIRST_NIGHTLY_RELEASE; // first nightly of current release
let FIRST_NIGHTLY_BETA; // first nightly of next version at release
let NIGHTLY;
let BETA;
let RELEASE;
let STATUS_RELEASE_VERSION;
let STATUS_BETA_VERSION;

function make_api_request(path, params) {
  let uri = API_BASE + path;
  if (params) {
    uri += "?" + params.toString();
  }
  return d3.json(uri).send("GET", null);
}

let gComponents;

function build_hub_request(version) {
  return {
    post_filter: {
      bool: {
        must: [
          {
            term: {
              "target.version": version + ".0a1",
            },
          },
          {
            term: {
              "target.channel": "nightly",
            },
          },
          {
            term: {
              "source.product": "firefox",
            },
          },
        ],
      },
    },
    size: 1,
    sort: [
      {
        "download.date": "asc",
      },
    ],
  };
}

async function get_versions() {
  const $loading = $("#loading");
  $loading.progressbar({ value: false });

  await fetch("https://product-details.mozilla.org/1.0/firefox_versions.json")
    .then((r) => {
      return r.json();
    })
    .then((r) => {
      NIGHTLY = r["FIREFOX_NIGHTLY"].split(".")[0];
      BETA = r["FIREFOX_DEVEDITION"].split(".")[0];
      RELEASE = r["LATEST_FIREFOX_VERSION"].split(".")[0];
      STATUS_RELEASE_VERSION = "cf_status_firefox" + RELEASE;
      STATUS_BETA_VERSION = "cf_status_firefox" + BETA;
    });

  await fetch("https://buildhub.moz.tools/api/search", {
    method: "post",
    body: JSON.stringify(build_hub_request(BETA)),
  })
    .then((r) => {
      return r.json();
    })
    .then((r) => {
      if (r.hits.hits.length !== 1) {
        alert("Failed to determine build date for v" + BETA);
      }
      FIRST_NIGHTLY_BETA = r.hits.hits[0]._source.download.date.substring(
        0,
        10
      );
    });

  await fetch("https://buildhub.moz.tools/api/search", {
    method: "post",
    body: JSON.stringify(build_hub_request(RELEASE)),
  })
    .then((r) => {
      return r.json();
    })
    .then((r) => {
      if (r.hits.hits.length !== 1) {
        alert("Failed to determine build date for v" + RELEASE);
      }
      FIRST_NIGHTLY_RELEASE = r.hits.hits[0]._source.download.date.substring(
        0,
        10
      );
    });

  console.log(
    "Current Versions:",
    "Nightly=" + NIGHTLY,
    "Beta=" + BETA,
    "Release=" + RELEASE
  );
  console.log(
    "First Nightly Dates:",
    "Beta=" + FIRST_NIGHTLY_BETA,
    "Release=" + FIRST_NIGHTLY_RELEASE
  );

  $loading.hide();
}

function get_components() {
  $("#loading").progressbar({ value: false });
  return fetch("components-min.json")
    .then(function (r) {
      return r.json();
    })
    .then(function (r) {
      gComponents = r;
      selected_from_url();
      $("#loading").hide();
    });
}

function selected_from_url() {
  let sp = new URLSearchParams(window.location.search);
  let components = new Set(sp.getAll("component"));
  gComponents.forEach(function (c) {
    c.selected = components.has(c.product_name + ":" + c.component_name);
  });
  setup_queries();
}

// Takes an array of bugs and returns only those for which there is
// at least one flag set that's a needinfo where the requestee and
// setter are not the same
function filter_self_needinfos(bugs) {
  return bugs.filter(function (bug) {
    return bug.flags.some(function (flag) {
      return flag.name === "needinfo" && flag.requestee !== flag.setter;
    });
  });
}

async function init() {
  $(".badge").hide();
  $("#tabs").tabs({ heightStyle: "fill", active: 1 });
  $(window).resize(function () {
    $("#tabs").tabs("refresh");
  });
  $("#stale-inner").accordion({
    heightStyle: "content",
    collapsible: true,
    active: false,
  });

  await get_versions();

  get_components()
    .then(setup_components)
    .then(() => {
      let selected = gComponents.filter(function (c) {
        return c.selected;
      });
      if (selected.length) {
        // Select the "stale" tab
        $("#tabs").tabs("option", "active", 2);
      }
    });

  d3.select("#filter").on("input", function () {
    setup_components();
  });
  window.addEventListener("popstate", function () {
    selected_from_url();
    setup_components();
  });
}

$(function () {
  init().then();
});

function setup_components() {
  let search = d3
    .select("#filter")
    .property("value")
    .toLowerCase()
    .split(/\s+/)
    .filter(function (w) {
      return w.length > 0;
    });
  let filtered;
  if (search.length == 0) {
    filtered = gComponents;
  } else {
    filtered = gComponents.filter(function (c) {
      let search_name = (
        c.product_name +
        ": " +
        c.component_name +
        " " +
        c.component_description
      ).toLowerCase();
      let found = true;
      search.forEach(function (w) {
        if (search_name.indexOf(w) == -1) {
          found = false;
        }
      });
      return found;
    });
  }
  let rows = d3
    .select("#components tbody")
    .selectAll("tr")
    .data(filtered, function (c) {
      return c.product_id + "_" + c.component_id;
    });
  let new_rows = rows.enter().append("tr");
  new_rows.on("click", function (d) {
    d.selected = !d.selected;
    d3.select(this).select("input").property("checked", d.selected);
    navigate_url();
    setup_queries();
  });
  new_rows.append("th").append("input").attr("type", "checkbox");
  new_rows.append("th").text(function (d) {
    return d.product_name + ": " + d.component_name;
  });
  new_rows.append("td").text(function (d) {
    return d.component_description;
  });
  rows.exit().remove();
  rows.selectAll("input").property("checked", function (d) {
    return !!d.selected;
  });
  document.getElementById("filter").removeAttribute("disabled");
}

let gPendingQueries = new Set();

function setup_queries() {
  gPendingQueries.forEach(function (r) {
    r.abort();
  });
  gPendingQueries.clear();

  let selected = gComponents.filter((c) => {
    return c.selected;
  });
  let components = [];
  selected.forEach((c) => {
    components.push({ product: c.product_name, component: c.component_name });
  });

  let to_triage = make_search(
    {
      email1: "wptsync%40mozilla.bugs",
      emailreporter1: "1",
      emailtype1: "notequals",
      resolution: "---",
      keywords_type: "nowords",
      keywords: "intermittent_failure",
      f1: "bug_type",
      o1: "equals",
      v1: "defect",
      f2: "flagtypes.name",
      o2: "notsubstring",
      v2: "needinfo",
      f3: "bug_severity",
      o3: "anyexact",
      v3: "--, n/a",
      limit: "0",
      chfield: "[Bug creation]",
      chfieldto: "Now",
      chfieldfrom: FIRST_NIGHTLY_RELEASE,
    },
    components
  );
  document.getElementById("triage-list").href =
    "https://bugzilla.mozilla.org/buglist.cgi?" + to_triage.toString();
  populate_table(
    $("#need-decision"),
    to_triage,
    $("#need-decision-marker"),
    !!selected.length
  );

  let stale_needinfo = make_search(
    {
      query_format: "advanced",
      resolution: "---",
      f1: "flagtypes.name",
      o1: "substring",
      v1: "needinfo",
      f2: "delta_ts",
      o2: "lessthan", // means "older than"
      v2: "14d",
    },
    components
  );
  document.getElementById("stuck-list").href =
    "https://bugzilla.mozilla.org/buglist.cgi?" + stale_needinfo.toString();
  populate_table(
    $("#needinfo-stale"),
    stale_needinfo,
    $("#needinfo-stale-marker"),
    !!selected.length,
    filter_self_needinfos
  );

  let stale_review = make_search(
    {
      query_format: "advanced",
      resolution: "---",
      f1: "flagtypes.name",
      o1: "regexp",
      v1: "^(review|superreview|ui-review|feedback|a11y-review)\\?",
      f2: "delta_ts",
      o2: "lessthan", // means "older than"
      v2: "5d",
    },
    components
  );
  document.getElementById("review-list").href =
    "https://bugzilla.mozilla.org/buglist.cgi?" + stale_review.toString();
  populate_table(
    $("#review-stale"),
    stale_review,
    $("#review-stale-marker"),
    !!selected.length
  );

  let stale_decision = make_search(
    {
      query_format: "advanced",
      resolution: "---",
      keywords: "regression",
      keywords_type: "allwords",
      chfield: "[Bug creation]",
      chfieldfrom: FIRST_NIGHTLY_BETA,
      chfieldto: "Now",
      f1: STATUS_BETA_VERSION,
      o1: "nowords",
      v1: "affected,unaffected,fixed,verified,disabled,verified disabled,wontfix,fix-optional",
    },
    components
  );

  document.getElementById("decision-list").href =
    "https://bugzilla.mozilla.org/buglist.cgi?" + stale_decision.toString();
  populate_table(
    $("#decision-stale"),
    stale_decision,
    $("#decision-stale-marker"),
    !!selected.length
  );

  let stale_range = make_search(
    {
      query_format: "advanced",
      resolution: "---",
      keywords: "regression",
      keywords_type: "allwords",
      chfield: "[Bug creation]",
      chfieldfrom: FIRST_NIGHTLY_BETA,
      chfieldto: "Now",
      f1: "OP",
      j1: "OR",
      f2: STATUS_RELEASE_VERSION,
      o2: "nowords",
      v2: "affected,unaffected,fixed,verified,disabled,verified disabled,wontfix,fix-optional",
      f3: STATUS_BETA_VERSION,
      o3: "nowords",
      v3: "affected,unaffected,fixed,verified,disabled,verified disabled,wontfix,fix-optional",
      f4: "CP",
    },
    components
  );
  document.getElementById("range-list").href =
    "https://bugzilla.mozilla.org/buglist.cgi?" + stale_range.toString();
  populate_table(
    $("#range-stale"),
    stale_range,
    $("#range-stale-marker"),
    !!selected.length
  );

  // generate search by severity value

  let by_severity = function (severity) {
    return make_search(
      {
        resolution: "---",
        chfield: "[Bug creation]",
        chfieldfrom: FIRST_NIGHTLY_RELEASE,
        chfieldto: "Now",
        f1: "bug_severity",
        o1: "anyexact",
        v1: severity,
        f2: "assigned_to",
        o2: "equals",
        v2: "nobody@mozilla.org",
        f3: "flagtypes.name",
        o3: "notsubstring",
        v3: "needinfo",
        f4: `cf_status_firefox${NIGHTLY}`,
        o4: "nowords",
        v4: "fixed, verified, wontfix, disabled, unaffected",
      },
      components
    );
  };

  let blockers = by_severity("s1");
  document.getElementById("blocker-list").href =
    "https:bugzilla.mozilla.org/buglist.cgi?" + blockers.toString();
  populate_table(
    $("#blockers"),
    blockers,
    $("#blocker-marker"),
    !!selected.length
  );

  let criticals = by_severity("s2");
  document.getElementById("critical-list").href =
    "https:bugzilla.mozilla.org/buglist.cgi?" + criticals.toString();
  populate_table(
    $("#criticals"),
    criticals,
    $("#critical-marker"),
    !!selected.length
  );
}

function navigate_url() {
  let u = new URL(window.location.href);
  let sp = u.searchParams;
  sp.delete("component");
  let selected = gComponents.filter(function (c) {
    return c.selected;
  });
  selected.forEach(function (c) {
    sp.append("component", c.product_name + ":" + c.component_name);
  });
  window.history.pushState(undefined, undefined, u.href);
}

function make_search(params, components) {
  let search = new URLSearchParams();

  // add provided query parameters
  let field_number = 0;
  Object.keys(params).forEach((name) => {
    if (name[0] === "f") {
      if (name === "j_top") {
        throw "Cannot set j_top, use a group with an OR joiner (f#=OP,j#=OR)";
      }
      const num = name.substring(1) * 1;
      if (num > field_number) {
        field_number = num;
      }
    }
    search.append(name, params[name]);
  });

  // Add components.  We can't use product= and component= query parameters as it
  // hits on matching products OR components, rather than a product/component pair.
  // Instead we build a query which does:
  // .. ((product AND component) OR (product AND component) ...)
  if (components.length) {
    field_number++;
    search.append("f" + field_number, "OP");
    search.append("j" + field_number, "OR");

    for (const c of components) {
      field_number++;
      search.append("f" + field_number, "OP");

      field_number++;
      search.append("f" + field_number, "product");
      search.append("o" + field_number, "equals");
      search.append("v" + field_number, c.product);

      field_number++;
      search.append("f" + field_number, "component");
      search.append("o" + field_number, "equals");
      search.append("v" + field_number, c.component);

      field_number++;
      search.append("f" + field_number, "CP");
    }

    field_number++;
    search.append("f" + field_number, "CP");
  }

  search.append(
    "include_fields",
    [
      "assigned_to",
      "component",
      "creation_time",
      "creator",
      "flags",
      "id",
      "keywords",
      "priority",
      "product",
      "severity",
      "summary",
      "type",
    ].join(",")
  );

  return search;
}

function bug_component(d) {
  return d.product + ": " + d.component;
}

function bug_type(d) {
  return d.type === "enhancement" ? "enh" : d.type;
}

function bug_description(d) {
  let s = d.summary;
  if (d.keywords.length) {
    s += " " + d.keywords.join(",");
  }
  return s;
}

function bug_users(d) {
  return (
    "Owner: " +
    escapeHtml(d.assigned_to_detail.nick) +
    "<br>Reporter: " +
    escapeHtml(d.creator_detail.nick)
  );
}

function bug_created(d) {
  return d3.time.format("%Y-%m-%d %H:%M")(new Date(d.creation_time));
}

function bug_priority(d) {
  switch (d.priority.toLowerCase()) {
    case "--":
      return "No Priority";
    case "p1":
      return "P1: This";
    case "p2":
      return "P2: Next";
    case "p3":
      return "P3: Backlog";
    case "p4":
      return "P4: Bot Managed";
    case "p5":
      return "P5: Community";
    default:
      return "Undefined";
  }
}

function bug_severity(d) {
  switch (d.severity.toLowerCase()) {
    case "--":
      return "-";
    case "s1":
      return "S1: (Catastrophic)";
    case "s2":
      return "S2: (Serious)";
    case "s3":
      return "S3: (Normal)";
    case "s4":
      return "S4: (Trivial)";
    case "n/a":
      return "Triage problem: Defects cannot have a severity of N/A";
    case "normal":
      return "Retriage";
    default:
      return d.severity + " (This should be updated to the new, correct value)";
  }
}

function populate_table(s, params, marker, some_selected, filter_fn) {
  if (!some_selected) {
    $(".p", s).hide();
    d3.select(s[0]).selectAll(".bugtable > tbody > tr").remove();
    return;
  }
  $(".p", s).progressbar({ value: false }).off("click");
  let r = make_api_request("bug", params)
    .on("load", function (data) {
      gPendingQueries.delete(r);
      $(".p", s)
        .button({
          icons: { primary: "ui-icon-refresh" },
          label: "Refresh",
          text: false,
        })
        .on("click", function () {
          populate_table(s, params, marker, true);
        });
      let bugs = filter_fn ? filter_fn(data.bugs) : data.bugs;
      if (!bugs.length) {
        marker.text("(none)").removeClass("pending");
      } else {
        marker.text("(" + bugs.length + ")").addClass("pending");
      }
      bugs.sort(function (a, b) {
        return d3.ascending(a.id, b.id);
      });
      let rows = d3
        .select(s[0])
        .select(".bugtable > tbody")
        .selectAll("tr")
        .data(bugs, function (d) {
          return d.id;
        });
      rows.exit().remove();
      let new_rows = rows.enter().append("tr");
      new_rows
        .append("th")
        .append("a")
        .attr("href", function (d) {
          return "https://bugzilla.mozilla.org/show_bug.cgi?id=" + d.id;
        })
        .attr("target", "_blank")
        .text(function (d) {
          return d.id;
        });
      new_rows.append("td").classed("bugtype", true);
      new_rows.append("td").classed("bugseverity", true);
      new_rows.append("td").classed("bugpriority", true);
      new_rows.append("td").classed("bugdescription", true);
      new_rows.append("td").classed("bugcomponent", true);
      new_rows.append("td").classed("bugusers", true);
      new_rows.append("td").classed("bugcreated", true);
      rows.select(".bugtype").text(bug_type);
      rows.select(".bugseverity").text(bug_severity);
      rows.select(".bugpriority ").text(bug_priority);
      rows.select(".bugdescription").text(bug_description);
      rows.select(".bugcomponent").text(bug_component);
      rows.select(".bugusers").html(bug_users);
      rows.select(".bugcreated").text(bug_created);
      rows.order();
    })
    .on("error", function (e) {
      console.log("XHR error", r, e, this);
      gPendingQueries.delete(r);
    });
  gPendingQueries.add(r);
}

function escapeHtml(text) {
  return text.replace(/["&<>]/g, function (a) {
    return { '"': "&quot;", "&": "&amp;", "<": "&lt;", ">": "&gt;" }[a];
  });
}
