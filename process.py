import json
import urllib2

fd = urllib2.urlopen("https://bugzilla.mozilla.org/rest/product?type=enterable&include_fields=id,name,components,is_active")
d = json.load(fd)

components = []
for p in d['products']:
    if not p['is_active']:
        continue
    for c in p['components']:
        if not c['is_active']:
            continue
        component_data = {
            'product_id': p['id'],
            'product_name': p['name'],
            'component_id': c['id'],
            'component_name': c['name'],
            'component_description': c['description'],
        }
        components.append(component_data)

fd = open("components-min.json", "w")
json.dump(components, fd)
