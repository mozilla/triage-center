var API_BASE = "https://bugzilla.mozilla.org/rest/";

https://bugzilla.mozilla.org/rest/product?type=accessible&include_fields=components

var gComponents;

function get_components() {
  return fetch("components-min.json")
    .then(function(r) { return r.json(); })
    .then(function(r) {
      gComponents = r;
      selected_from_url();
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

document.addEventListener("DOMContentLoaded", function() {
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

function setup_queries() {
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

  var stale_review = make_search({
    f1: "flagtypes.name",
    o1: "regexp",
    v1: "(review|superreview|ui-review|feedback|a11y-review)\?",
    resolution: "---",
    f2: "delta_ts",
    o2: "lessthan", // means "older than"
    v2: "5d",
    query_format: "advanced",
  }, common_params);
  document.getElementById("review-list").href = "https://bugzilla.mozilla.org/buglist.cgi?" + stale_review.toString();
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
