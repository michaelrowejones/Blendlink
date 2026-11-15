"""JSON-only cross-language structural test entry point. No Blender/native calls."""
import json,sys
from generated.contracts import decode,encode,CASE_COUNTS
rows=json.load(sys.stdin);results=[]
for row in rows:
    try:
        decoded=decode(row['family'],row['program'])
        assert json.loads(encode(row['family'],decoded))==row['program']
        results.append(True)
    except (ValueError,TypeError,KeyError): results.append(False)
print(json.dumps({'accepted':results,'counts':CASE_COUNTS}))
