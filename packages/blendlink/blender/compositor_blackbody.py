# SPDX-License-Identifier: GPL-3.0-or-later
"""Static compositor Blackbody uses IMB CPU MF even in GPU-authored trees."""
import hashlib
import math
from pathlib import Path
import platform
import sys
import bpy
MODEL='native-imb-blackbody-literal-53-v1'
PROFILE='darwin-arm64-53-imb-blackbody-v1'
TABLE_SHA256='38733f76b437b81362e4cc018833ded1c5544ab1a944215baef7d08268040e78'
OCIO_SHA256='066a440ed1c02551fa3cacbb3af5d22d2efde7e4da5f2c14dffcca00c47751a0'

def require_working_space(fail,socket):
 colorspace=getattr(bpy.data,'colorspace',None)
 if (colorspace is None or colorspace.working_space_interop_id!='lin_rec709_scene'
     or colorspace.ocio_config_source!='BLENDER' or colorspace.is_missing_opencolorio_config or colorspace.is_failed_opencolorio_config):
  fail(socket,'Blackbody requires the qualified bundled Linear Rec709 working space; custom/failed/missing configurations remain unqualified')
 config=Path(colorspace.ocio_config_path)
 try:config_hash=hashlib.sha256(config.read_bytes()).hexdigest()
 except OSError:fail(socket,'Blackbody cannot read the active bundled OCIO source configuration')
 if config_hash!=OCIO_SHA256:fail(socket,'Blackbody bundled OCIO source differs from the qualified source profile')
 tables=Path(__file__).with_name('spectral_tables.json')
 if not tables.is_file():tables=Path(__file__).resolve().parents[2]/'blender-addon'/'spectral_tables.json'
 try:table_hash=hashlib.sha256(tables.read_bytes()).hexdigest()
 except OSError:fail(socket,'Blackbody shared spectral coefficient registry is missing')
 if table_hash!=TABLE_SHA256:fail(socket,'Blackbody shared spectral coefficients differ from the qualified source table')
 return config_hash,table_hash

def normalize_blackbody(node,socket,op,read,operations,fail,literal):
 if (tuple(bpy.app.version)!=(5,3,0)or bpy.app.build_hash!=b'02f0899d78e3'or sys.platform!='darwin'or platform.machine()!='arm64'):
  fail(socket,'Blackbody requires its measured Blender5.3 macOS arm64 source profile')
 if socket.identifier!='Color'or socket.type!='RGBA':fail(socket,'Blackbody qualifies its native RGBA Color output only')
 p=op['properties']
 if p.get('evaluation_device')not in{'CPU','GPU'}or p.get('single_value_device')!='CPU':fail(socket,'Blackbody literal source requires the modern CPU-MF single-value evaluator')
 if p.get('evaluation_device')=='GPU'and p.get('native_gpu_backend')!='METAL':fail(socket,'Blackbody GPU-authored source requires the measured native Metal profile')
 config_hash,table_hash=require_working_space(fail,socket)
 incoming=read(node.inputs['Temperature']);temperature=literal(incoming,operations,'VALUE')
 if (isinstance(temperature,bool)or not isinstance(temperature,(int,float))or not math.isfinite(temperature)or not 800<=temperature<=12000):
  fail(socket,'Blackbody requires a literal/Value/group stored Float32 Temperature800..12000; fields/computed inputs use a different native source path')
 op['inputs']['Temperature']={'name':'Temperature','socketType':'VALUE','value':incoming}
 p.update(blackbody_model=MODEL,blackbody_profile=PROFILE,blackbody_version=list(bpy.app.version),blackbody_build=bpy.app.build_hash.decode(),
          blackbody_evaluator='CPU-MF',blackbody_working_space='lin_rec709_scene',blackbody_color_transform='native-rec709-bypass-53-v1',
          blackbody_ocio_sha256=config_hash,blackbody_table_sha256=table_hash)
