import json

#  wget "https://bugzilla.mozilla.org/rest/product?type=accessible&include_fields=id,name,components" -O components.json

d = json.load(open("components.json"))

components = []
for p in d['products']:
    for c in p['components']:
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
