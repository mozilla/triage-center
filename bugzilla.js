var API_BASE = "https://bugzilla.mozilla.org/rest/";

/**
 * @returns d3.request
 */
function make_api_request(path, params, data, method) {
  var uri = API_BASE + path;
  if (params) {
    uri += "?" + params.toString();
  }
  var r = d3.json(uri);

  method = "GET";
  data = null;

  return r.send(method, data);
}

var gComponents;

function get_components() {
  $("#component-loading").progressbar({ value: false });
  return fetch("components-min.json")
    .then(function(r) { return r.json(); })
    .then(function(r) {
      gComponents = r;
      selected_from_url();
      $("#component-loading").hide();
    });
}

function selected_from_url() {
  var sp = new URLSearchParams(window.location.search);
  var components = new Set(sp.getAll("component"));
  gComponents.forEach(function(c) {
    var test = c.product_name + ":" + c.component_name;
    c.selected = components.has(test);
  });
  setup_queries();
}

$(function() {
  $(".badge").hide();
  $("#tabs").tabs({ heightStyle: "fill", active: 1 });
  $("#stale-inner").accordion({ heightStyle: "content", collapsible: true, active: false });

  get_components().then(setup_components);
  d3.select("#filter").on("input", function() {
    setup_components();
  });
  window.addEventListener("popstate", function() {
    selected_from_url();
    setup_components();
  });
});

function setup_components() {
  var search = d3.select("#filter").property("value").toLowerCase().split(/\s+/).filter(function(w) { return w.length > 0; });
  var filtered;
  if (search.length == 0) {
    filtered = gComponents;
  } else {
    filtered = gComponents.filter(function(c) {
      var search_name = (c.product_name + ": " + c.component_name + " " + c.component_description).toLowerCase();
      var found = true;
      search.forEach(function(w) {
        if (search_name.indexOf(w) == -1) {
          found = false;
        }
      });
      return found;
    });
  }
  var rows = d3.select("#components tbody").selectAll("tr")
    .data(filtered, function(c) { return c.product_id + "_" + c.component_id; });
  var new_rows = rows.enter().append("tr");
  new_rows.on("click", function(d) {
    d.selected = !d.selected;
    d3.select(this).select("input").property("checked", d.selected);
    navigate_url();
    setup_queries();
  });
  new_rows.append("th").append("input")
    .attr("type", "checkbox");
  new_rows.append("th").text(function(d) {
    return d.product_name + ": " + d.component_name;
  });
  new_rows.append("td").text(function(d) {
    return d.component_description;
  });
  rows.exit().remove();
  rows.selectAll("input").property("checked", function(d) { return !!d.selected; });
  document.getElementById('filter').removeAttribute('disabled');
}

var gPendingQueries = new Set();

function setup_queries() {
  gPendingQueries.forEach(function(r) {
    r.abort();
  });
  gPendingQueries.clear();

  var selected = gComponents.filter(function(c) { return c.selected; });
  var products = new Set();
  var components = new Set();
  selected.forEach(function(c) {
    products.add(c.product_name);
    components.add(c.component_name);
  });

  var common_params = new URLSearchParams();
  Array.from(products.values()).forEach(function(p) {
    common_params.append("product", p);
  });
  Array.from(components.values()).forEach(function(c) {
    common_params.append("component", c);
  });

  var to_triage = make_search({
    priority: "--",
    n1: 1,
    f1: "flagtypes.name",
    o1: "substring",
    v1: "needinfo",
    resolution: "---",
    chfield: "[Bug creation]",
    chfieldto: "Now",
    query_format: "advanced",
    chfieldfrom: "2016-06-01",
  }, common_params);
  document.getElementById("triage-list").href = "https://bugzilla.mozilla.org/buglist.cgi?" + to_triage.toString();
  populate_table($("#need-decision"), to_triage, $("#need-decision-marker"), !!selected.length);

  var stale_needinfo = make_search({
    f1: "flagtypes.name",
    o1: "substring",
    v1: "needinfo",
    f2: "delta_ts",
    o2: "lessthan", // means "older than"
    v2: "14d",
    resolution: "---",
    query_format: "advanced",
  }, common_params);
  document.getElementById("stuck-list").href = "https://bugzilla.mozilla.org/buglist.cgi?" + stale_needinfo.toString();
  populate_table($("#needinfo-stale"), stale_needinfo, $("#needinfo-stale-marker"), !!selected.length);

  var stale_review = make_search({
    f1: "flagtypes.name",
    o1: "regexp",
    v1: "(review|superreview|ui-review|feedback|a11y-review)\\?",
    resolution: "---",
    f2: "delta_ts",
    o2: "lessthan", // means "older than"
    v2: "5d",
    query_format: "advanced",
  }, common_params);
  document.getElementById("review-list").href = "https://bugzilla.mozilla.org/buglist.cgi?" + stale_review.toString();
  populate_table($("#review-stale"), stale_review, $("#review-stale-marker"), !!selected.length);

  var stale_decision = make_search({
    keywords: "regression",
    keywords_type: "allwords",
    v1: "affected,unaffected,fixed,verified,disabled,verified,disabled,wontfix,fix-optional",
    chfieldto: "Now",
    o1: "nowords",
    chfield: "[Bug creation]",
    chfieldfrom: "2016-04-25", // change to date of first nightly of next version at release
    f1: "cf_status_firefox49", // change to next version at release
    resolution: "---",
    query_format: "advanced"
  }, common_params);

  document.getElementById("decision-list").href = "https://bugzilla.mozilla.org/buglist.cgi?" + stale_decision.toString();
  populate_table($("#decision-stale"), stale_decision, $("#decision-stale-marker"), !!selected.length);

  var stale_range = make_search({
    chfield: "[Bug creation]",
    chfieldfrom: "2016-04-25", // change to date of first nightly of next version at release
    chfieldto: "Now",
    f10: "OP",
    f11: "cf_has_regression_range",
    f12: "cf_has_regression_range",
    f13: "CP",
    f1: "OP",
    f2: "keywords",
    f3: "CP", 
    f4: "OP",
    f5: "cf_status_firefox49",
    f6: "cf_status_firefox50",
    f7: "cf_status_firefox51",
    f8: "CP",
    j10: "OR",
    j_top: "OR",
    keywords: "regression",
    keywords_type: "allwords",
    o11: "equals",
    o12: "equals",
    o2: "substring",
    o5: "nowords",
    o6: "nowords",
    o7: "nowords",
    query_format: "advanced",
    resolution: "---",
    v11: "no",
    v12: "---",
    v2: "regressionwindow-wanted",
    v5: "affected,unaffected,fixed,verified,disabled,verified disabled,wontfix,fix-optional",
    v6: "affected,unaffected,fixed,verified,disabled,verified disabled,wontfix,fix-optional",
    v7: "affected,unaffected,fixed,verified,disabled,verified disabled,wontfix,fix-optional"
  }, common_params);
  document.getElementById("range-list").href = "https://bugzilla.mozilla.org/buglist.cgi?" + stale_range.toString();
  populate_table($("#range-stale"), stale_range, $("#range-stale-marker"), !!selected.length);
}

function navigate_url() {
  var u = new URL(window.location.href);
  var sp = u.searchParams;
  sp.delete("component");
  var selected = gComponents.filter(function(c) { return c.selected; });
  selected.forEach(function(c) {
    sp.append("component", c.product_name + ":" + c.component_name);
  });
  window.history.pushState(undefined, undefined, u.href);
}

function make_search(o, base) {
  var s = new URLSearchParams(base);
  Object.keys(o).forEach(function(k) {
    var v = o[k];
    if (v instanceof Array) {
      v.forEach(function(v2) {
        s.append(k, v2);
      });
    } else {
      s.append(k, v);
    }
  });
  return s;
}

function bug_description(d) {
  var s = d.product + ": " + d.component + " - " + d.summary;
  if (d.keywords.length) {
    s += " " + d.keywords.join(",");
  }
  s += " Owner: " + d.assigned_to;
  s += " Reporter: " + d.creator;
  s += " Created: " + d3.time.format("%Y-%m-%d %H:%M")(new Date(d.creation_time));
  return s;
}

function bug_priority(d) {
    var priority = '';
    switch (d.priority.toLowerCase()) {
        case '--':
            priority = 'No Priority';
            break;
        case 'p1':
            priority = 'P1: This Release/Iteration';
            break;
        case 'p2':
            priority = 'P2: Next Release/Iteration';
            break;
        case 'p3':
            priority = 'P3: Backlog';
            break;
        case 'p4':
            priority = 'P4: Backlog (but should be P3)';
            break;
        case 'p5':
            priority = 'P5: Won\'t fix but will accept a patch';
            break;
        default:
            priority = 'Undefined (this shouldn\'t happen)';
    }
    return priority;
}

function populate_table(s, params, marker, some_selected) {
  if (!some_selected) {
    $(".p", s).hide();
    d3.select(s[0]).selectAll('.bugtable > tbody > tr').remove();
    return;
  }
  $(".p", s).progressbar({ value: false }).off("click");
  var r = make_api_request("bug", params).on("load", function(data) {
    gPendingQueries.delete(r);
    $(".p", s)
      .button({ icons: { primary: 'ui-icon-refresh' }, label: 'Refresh', text: false })
      .on("click", function() { populate_table(s, params, marker, true); });
    var bugs = data.bugs;
    if (!bugs.length) {
      marker.text("(none!)").removeClass("pending");
    } else {
      marker.text("(" + bugs.length + ")").addClass("pending");
    }
    bugs.sort(function(a, b) { return d3.ascending(a.id, b.id); });
    var rows = d3.select(s[0]).select('.bugtable > tbody').selectAll('tr')
      .data(bugs, function(d) { return d.id; });
    rows.exit().remove();
    var new_rows = rows.enter().append("tr");
    new_rows.append("th").append("a")
      .attr("href", function(d) { return "https://bugzilla.mozilla.org/show_bug.cgi?id=" + d.id; }).text(function(d) { return d.id; });
    new_rows.append("td").classed("bugpriority", true);
    new_rows.append("td").classed("bugdescription", true);
    rows.select(".bugpriority ").text(bug_priority);
    rows.select(".bugdescription").text(bug_description);
    rows.order();
  }).on("error", function(e) {
    console.log("XHR error", r, e, this);
    gPendingQueries.delete(r);
  });
  gPendingQueries.add(r);
}

