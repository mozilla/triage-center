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
  rows.selectAll("input").property("checked", function(d) { return !!d.selected;  document.getElementById('filter').removeAttribute('disabled');
 });
}

function setup_queries() {
  var selected = gComponents.filter(function(c) { return c.selected; });
  var products = new Set();
  var components = new Set();
  selected.forEach(function(c) {
    products.add(c.product_name);
    components.add(c.component_name);
  });
  var product_params = Array.from(products.values()).map(function(c) {
    return "product=" + encodeURIComponent(c);
  }).join("&");
  var component_params = Array.from(components.values()).map(function(c) {
    return "component=" + encodeURIComponent(c);
  }).join("&");
  var to_triage = "https://bugzilla.mozilla.org/buglist.cgi?priority=--&f1=flagtypes.name&o1=substring&resolution=---&n1=1&chfield=%5BBug%20creation%5D&chfieldto=Now&query_format=advanced&chfieldfrom=2016-06-01&bug_status=UNCONFIRMED&bug_status=NEW&bug_status=ASSIGNED&bug_status=REOPENED&v1=needinfo&" + product_params + "&" + component_params;
  document.getElementById("triage-list").href = to_triage;
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

// https://bugzilla.mozilla.org/buglist.cgi?priority=--&f1=flagtypes.name&list_id=13068490&o1=substring&resolution=---&n1=1&chfieldto=Now&query_format=advanced&chfield=%5BBug%20creation%5D&chfieldfrom=2016-06-01&bug_status=UNCONFIRMED&bug_status=NEW&bug_status=ASSIGNED&bug_status=REOPENED&v1=needinfo&component=Plug-ins&product=Core
