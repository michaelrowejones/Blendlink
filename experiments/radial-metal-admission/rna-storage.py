import bpy,gpu,array,struct,json
n=bpy.data.node_groups.new('Probe','ShaderNodeTree').nodes.new('ShaderNodeRadialTiling');v=n.inputs['Vector'].default_value
raw=array.array('f');raw.frombytes(struct.pack('<2I',1,0x80000001));v.foreach_set(raw)
def words():
 b=array.array('f',[0,0]);v.foreach_get(b);return list(struct.unpack('<2I',b.tobytes()))
before=words();gpu.init();after=words();promoted=list(v)
print('RNA_RAW '+json.dumps({'before':before,'after':after,'promoted':promoted,'backend':gpu.platform.backend_type_get()}));assert before==after==[1,0x80000001]
