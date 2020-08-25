"use strict";

const API_BASE = "https://bugzilla.mozilla.org/rest/";

// change for each release

const FIRST_NIGHTLY_CURRENT = "2020-06-01"; // first nightly of current release
const FIRST_NIGHTLY_NEXT = "2020-07-07"; // first nightly of next version at release
const NIGHTLY = "81";
const BETA = "80";
const RELEASE = "79";
const STATUS_RELEASE_VERSION = "cf_status_firefox" + RELEASE;
const STATUS_BETA_VERSION = "cf_status_firefox" + BETA;

/**
 * @returns d3.request
 */
function make_api_request(path, params, data, method) {
  let uri = API_BASE + path;
  if (params) {
    uri += "?" + params.toString();
  }
  let r = d3.json(uri);

  method = "GET";
  data = null;

  return r.send(method, data);
}

let gComponents;

function get_components() {
  $("#component-loading").progressbar({ value: false });
  return fetch("components-min.json")
    .then(function (r) {
      return r.json();
    })
    .then(function (r) {
      gComponents = r;
      selected_from_url();
      $("#component-loading").hide();
    });
}

function selected_from_url() {
  let sp = new URLSearchParams(window.location.search);
  let components = new Set(sp.getAll("component"));
  gComponents.forEach(function (c) {
    let test = c.product_name + ":" + c.component_name;
    c.selected = components.has(test);
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

$(function () {
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

  let selected = gComponents.filter(function (c) {
    return c.selected;
  });
  let products = new Set();
  let components = new Set();
  selected.forEach(function (c) {
    products.add(c.product_name);
    components.add(c.component_name);
  });

  let common_params = new URLSearchParams();
  Array.from(products.values()).forEach(function (p) {
    common_params.append("product", p);
  });
  Array.from(components.values()).forEach(function (c) {
    common_params.append("component", c);
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
      chfieldfrom: FIRST_NIGHTLY_CURRENT, // Change to first nightly of current release
    },
    common_params
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
      f1: "flagtypes.name",
      o1: "substring",
      v1: "needinfo",
      f2: "delta_ts",
      o2: "lessthan", // means "older than"
      v2: "14d",
      resolution: "---",
      query_format: "advanced",
    },
    common_params
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
      f1: "flagtypes.name",
      o1: "regexp",
      v1: "^(review|superreview|ui-review|feedback|a11y-review)\\?",
      resolution: "---",
      f2: "delta_ts",
      o2: "lessthan", // means "older than"
      v2: "5d",
      query_format: "advanced",
    },
    common_params
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
      keywords: "regression",
      keywords_type: "allwords",
      v1:
        "affected,unaffected,fixed,verified,disabled,verified disabled,wontfix,fix-optional",
      chfieldto: "Now",
      o1: "nowords",
      chfield: "[Bug creation]",
      chfieldfrom: FIRST_NIGHTLY_NEXT, // change to date of first nightly of next version at release
      f1: STATUS_BETA_VERSION, // change to next version at release
      resolution: "---",
      query_format: "advanced",
    },
    common_params
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
      chfield: "[Bug creation]",
      chfieldfrom: FIRST_NIGHTLY_NEXT, // change to date of first nightly of next version at release
      chfieldto: "Now",
      f1: STATUS_RELEASE_VERSION, // increment version numbers at release
      f2: STATUS_BETA_VERSION,
      j_top: "OR",
      keywords: "regression",
      keywords_type: "allwords",
      o1: "nowords",
      o2: "nowords",
      query_format: "advanced",
      resolution: "---",
      v1:
        "affected,unaffected,fixed,verified,disabled,verified disabled,wontfix,fix-optional",
      v2:
        "affected,unaffected,fixed,verified,disabled,verified disabled,wontfix,fix-optional",
    },
    common_params
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
        chfieldfrom: FIRST_NIGHTLY_CURRENT,
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
      common_params
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

function make_search(o, base) {
  let s = new URLSearchParams(base);
  Object.keys(o).forEach(function (k) {
    let v = o[k];
    if (v instanceof Array) {
      v.forEach(function (v2) {
        s.append(k, v2);
      });
    } else {
      s.append(k, v);
    }
  });
  return s;
}

function bug_component(d) {
  return d.product + ": " + d.component;
}

function bug_type(d) {
  return d.type;
}

function bug_description(d) {
  let s = d.summary;
  if (d.keywords.length) {
    s += " " + d.keywords.join(",");
  }
  return s;
}

function bug_users(d) {
  let s = "Owner: " + d.assigned_to;
  s += " Reporter: " + d.creator;
  return s;
}

function bug_created(d) {
  return d3.time.format("%Y-%m-%d %H:%M")(new Date(d.creation_time));
}

function bug_priority(d) {
  switch (d.priority.toLowerCase()) {
    case "--":
      return "No Priority";
    case "p1":
      return "P1: This Release/Iteration";
    case "p2":
      return "P2: Next Release/Iteration";
    case "p3":
      return "P3: Backlog";
    case "p4":
      return "P4: Bot Managed";
    case "p5":
      return "P5: Won't fix but will accept a patch";
    default:
      return "Undefined (this shouldn't happen; contact the maintainer)";
  }
}

function bug_severity(d) {
  switch (d.severity.toLowerCase()) {
    case "--":
      return "No Severity Set";
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
      return "Normal (this is the old default value; and should be reviewed)";
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
        marker.text("(none!)").removeClass("pending");
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
      rows.select(".bugusers").text(bug_users);
      rows.select(".bugcreated").text(bug_created);
      rows.order();
    })
    .on("error", function (e) {
      console.log("XHR error", r, e, this);
      gPendingQueries.delete(r);
    });
  gPendingQueries.add(r);
}
