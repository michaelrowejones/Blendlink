import hashlib
import json
import os
import pathlib
import unittest
from specialize import clone_helper,clone_entry,HELPER,CLONE,ENTRY,ENTRY_CLONE

CANONICAL=pathlib.Path(os.environ.get('SCENETOWEB_CANONICAL','/tmp/scenetoweb-shader-kernel-next-build/generated-r5'))
SOURCE=(CANONICAL/'canonical-library.glsl').read_text()
TABLE=json.loads(pathlib.Path('/tmp/scenetoweb-native-shader-constants-r1.json').read_text())['table']


class SpecializationTests(unittest.TestCase):
 def test_actual_source_changes_only_two_calls_and_derived_names(self):
  before=hashlib.sha256(SOURCE.encode()).hexdigest();clone,proof=clone_helper(SOURCE,TABLE);entry,ep=clone_entry(SOURCE)
  self.assertEqual([c['seed']for c in proof['substitutedCalls']],[3,4]);self.assertEqual(clone.count('uintBitsToFloat(uvec3('),2)
  self.assertIn('void '+CLONE+'(',clone);self.assertIn('void '+ENTRY_CLONE+'(',entry);self.assertEqual(entry.count(CLONE+'('),1)
  self.assertNotIn('uintBitsToFloat(uvec3(',proof['original']);self.assertEqual(hashlib.sha256(SOURCE.encode()).hexdigest(),before)
  self.assertEqual(proof['editedSpans'],3);self.assertEqual(ep['editedSpans'],2)
 def test_changed_seed_binding_refuses(self):
  changed=SOURCE.replace('float color_seed_offset(vec3 _0)\n{\n  return 3.0f;','float color_seed_offset(vec3 _0)\n{\n  return 4.0f;')
  self.assertNotEqual(changed,SOURCE)
  with self.assertRaises(AssertionError):clone_helper(changed,TABLE)
 def test_changed_call_expression_refuses(self):
  changed=SOURCE.replace('random_offsetTfloat3(seed_base + 0.0f)','random_offsetTfloat3(seed_base + detail)',1)
  self.assertNotEqual(changed,SOURCE)
  with self.assertRaises(AssertionError):clone_helper(changed,TABLE)
 def test_extra_helper_call_refuses(self):
  clone,proof=clone_helper(SOURCE,TABLE);original=proof['original'];needle='float seed_base = color_seed_offset(p);'
  self.assertIn(needle,original)
  changed=SOURCE.replace(original,original.replace(needle,needle+' value += random_offsetTfloat3(seed_base + 0.0f).x;'))
  with self.assertRaises(AssertionError):clone_helper(changed,TABLE)
 def test_missing_or_changed_table_schema_refuses(self):
  with self.assertRaises(AssertionError):clone_helper(SOURCE,TABLE[:1])
  bad=json.loads(json.dumps(TABLE));bad[0]['words'][0]=True
  with self.assertRaises(AssertionError):clone_helper(SOURCE,bad)
 def test_duplicate_definition_refuses(self):
  original=clone_helper(SOURCE,TABLE)[1]['original']
  with self.assertRaises(AssertionError):clone_helper(SOURCE+'\n'+original,TABLE)


if __name__=='__main__':unittest.main()
