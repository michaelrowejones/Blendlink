# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-sentinel: BLENDLINK_COMPOSITOR_IMAGE_PASSED
"""Independent native static image pixels, finite windows and preservation."""
import base64,hashlib,importlib,json,os,shutil,struct,sys,tempfile,types,zlib
from pathlib import Path
import bpy
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parent))
from compositor_reference import NativeCompositorReference
import compositor_graph


def image_state(image):
    pixels=np.empty(len(image.pixels),np.float32);image.pixels.foreach_get(pixels)
    return (image.name,image.filepath,image.filepath_raw,image.file_format,image.source,image.type,
        image.colorspace_settings.name,image.alpha_mode,image.is_dirty,image.is_float,image.users,
        hashlib.sha256(pixels.tobytes()).hexdigest(),
        [hashlib.sha256(bytes(packed.packed_file.data)).hexdigest() for packed in image.packed_files])


def png(path,pixels):
    height,width=pixels.shape[:2]
    def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data))
    data=bytes([137,80,78,71,13,10,26,10])+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,6 if pixels.shape[2]==4 else 2,0,0,0))
    data+=chunk(b'IDAT',zlib.compress(b''.join(bytes([0])+row.tobytes() for row in pixels[::-1])))+chunk(b'IEND',b'')
    path.write_bytes(data)


def main(destination):
    oracle=NativeCompositorReference(destination,device='CPU',name='Static Image reference',
        pixels=np.random.default_rng(832513).uniform(-.5,2,(8,16,4)).astype(np.float32))
    oracle.scene.render.engine='BLENDER_EEVEE_NEXT' if bpy.app.version<(5,0) else 'BLENDER_EEVEE'
    oracle.scene.eevee.taa_render_samples=1
    tree=oracle.tree
    images=[]
    for storage in ['float','png','packed','byte']:
        for width,height in [(8,4),(16,8),(32,16)]:
            y,x=np.mgrid[:height,:width]
            values=np.stack([(x*31+y*11)%256,(x*73+y*7)%256,(x*13+y*47)%256,
                np.asarray([0,1,64,128,192,255],np.uint8)[x%6]],axis=-1).astype(np.uint8)
            if storage in {'png','packed'}:
                path=destination/f'authored-{storage}-{width}x{height}.png';png(path,values)
                image=bpy.data.images.load(str(path),check_existing=False)
                image.colorspace_settings.name='sRGB'
                if storage=='packed':image.pack()
            else:
                image=bpy.data.images.new(f'Artist {storage} {width}x{height}',width=width,height=height,alpha=True,float_buffer=storage=='float')
                image.colorspace_settings.name='Linear Rec.709' if storage=='float' else 'sRGB'
                pixels=values.astype(np.float32)/255
                if storage=='float':
                    pixels[...,:3]=pixels[...,:3]*4-.5
                    pixels[...,3]=np.asarray([-.5,0,.125,.5,1,2],np.float32)[x%6]
                image.pixels.foreach_set(pixels.ravel())
            image['artist-note']='keep input intact'
            images.append(image)
            modes=['STRAIGHT','PREMUL'] if storage=='byte' else ['STRAIGHT','PREMUL','CHANNEL_PACKED','NONE']
            for mode in modes:
                image.alpha_mode=mode
                for output in ['Image','Alpha']:
                    sink,unused=oracle.reset()
                    node=tree.nodes.new('CompositorNodeImage');node.image=image;node.label='Keep authored image';node['artist-note']='keep node'
                    tree.links.new(node.outputs[output],sink.inputs[0])
                    before=image_state(image);counts=(len(bpy.data.images),len(bpy.data.scenes));state=repr([(n.name,list(n.items())) for n in tree.nodes])
                    program=compositor_graph.extract(oracle.scene)
                    assert program['status']=='extracted',program
                    assert before==image_state(image) and counts==(len(bpy.data.images),len(bpy.data.scenes)) and state==repr([(n.name,list(n.items())) for n in tree.nodes]),'Extraction changed source image or leaked a decoder ID'
                    assert len(program['images'])==1
                    oracle.save(f'image-{storage}-{width}x{height}-{mode}-{output}',unused)
    # Pointwise operations must execute before finite-window padding.
    for kind in ['invert','exposure','both-outputs']:
        sink,unused=oracle.reset();node=tree.nodes.new('CompositorNodeImage');node.image=images[0]
        if kind=='invert':
            grade=tree.nodes.new('CompositorNodeInvert');tree.links.new(node.outputs['Image'],grade.inputs['Color']);output=grade.outputs[0]
        elif kind=='exposure':
            grade=tree.nodes.new('CompositorNodeExposure');tree.links.new(node.outputs['Image'],grade.inputs['Image']);grade.inputs['Exposure'].default_value=1;output=grade.outputs[0]
        else:
            grade=tree.nodes.new('CompositorNodeAlphaOver')
            tree.links.new(node.outputs['Image'],grade.inputs['Background' if oracle.modern else 'Image'])
            tree.links.new(node.outputs['Image'],grade.inputs['Foreground' if oracle.modern else 'Image_001'])
            tree.links.new(node.outputs['Alpha'],grade.inputs['Factor' if oracle.modern else 'Fac']);output=grade.outputs[0]
        tree.links.new(output,sink.inputs[0]);before=image_state(node.image)
        program=compositor_graph.extract(oracle.scene)
        assert program['status']=='extracted' and len(program['images'])==1 and image_state(node.image)==before,program
        oracle.save('image-pointwise-'+kind,unused)
    # Unsaved painting changes must ship the live buffer rather than the
    # original packed/file bytes, without marking the source image saved.
    for storage,index in [('png',3),('packed',6)]:
        image=images[index];image.alpha_mode='STRAIGHT'
        paint=np.resize(np.asarray([[.2,.7,.9,0],[.75,.1,.4,.5],[1,.5,.25,1]],np.float32),(4,8,4))
        image.pixels.foreach_set(paint.ravel());image.update()
        for output in ['Image','Alpha']:
            sink,unused=oracle.reset();node=tree.nodes.new('CompositorNodeImage');node.image=image
            tree.links.new(node.outputs[output],sink.inputs[0]);before=image_state(image)
            program=compositor_graph.extract(oracle.scene);assert program['status']=='extracted',program
            assert image_state(image)==before
            oracle.save('image-painted-'+storage+'-'+output,unused)
    path=destination/'authored-rgb.png'
    rgb=np.resize(np.asarray([[17,128,231],[64,172,255],[128,31,64],[255,128,17]],np.uint8),(4,8,3))
    png(path,rgb);image=bpy.data.images.load(str(path),check_existing=False);image.colorspace_settings.name='sRGB';image.pack()
    for output in ['Image','Alpha']:
        sink,unused=oracle.reset();node=tree.nodes.new('CompositorNodeImage');node.image=image
        tree.links.new(node.outputs[output],sink.inputs[0]);before=image_state(image)
        result=compositor_graph.extract(oracle.scene);assert result['status']=='extracted' and image_state(image)==before,result
        oracle.save('image-packed-rgb-'+output,unused)
    # A normal 1080p background stays losslessly compressed in the presentation
    # asset and retains its native resolution while a small viewport crops it.
    width,height=1920,1080
    yy,xx=np.mgrid[:height,:width]
    pixels=np.stack([(xx*7+yy*13)%256,(xx*31+yy*11)%256,(xx*17+yy*3)%256,
        np.asarray([0,64,128,255],np.uint8)[xx%4]],axis=-1).astype(np.uint8)
    path=destination/'authored-1080p.png';png(path,pixels)
    large=bpy.data.images.load(str(path),check_existing=False);large.colorspace_settings.name='sRGB';large.alpha_mode='STRAIGHT';large.pack()
    sink,unused=oracle.reset();node=tree.nodes.new('CompositorNodeImage');node.image=large
    tree.links.new(node.outputs['Image'],sink.inputs[0]);before=image_state(large)
    program=compositor_graph.extract(oracle.scene);assert program['status']=='extracted' and image_state(large)==before,program
    payload=next(iter(program['images'].values()))
    assert payload['decodedBytes']==width*height*16 and len(base64.b64decode(payload['data']))<payload['decodedBytes']/4
    oracle.save('image-packed-1080p-crop',unused)
    # Exercise the same compiled image program across live viewport/DPR changes.
    # Reference pixels remain independent native renders, not fitted centering.
    for width,height in ([(8,4)] if bpy.app.version<(5,0) else [(1,1),(7,5),(8,4)]):
        yy,xx=np.mgrid[:height,:width]
        values=np.empty((height,width,4),np.float32)
        values[...,0]=xx/8-.25;values[...,1]=yy/4;values[...,2]=(xx+yy)/16;values[...,3]=.5
        image=bpy.data.images.new('Artist responsive image',width=width,height=height,alpha=True,float_buffer=True)
        image.colorspace_settings.name='Linear Rec.709';image.pixels.foreach_set(values.ravel())
        sink,unused=oracle.reset();node=tree.nodes.new('CompositorNodeImage');node.image=image
        grade=tree.nodes.new('CompositorNodeInvert');tree.links.new(node.outputs['Image'],grade.inputs['Color'])
        tree.links.new(grade.outputs[0],sink.inputs[0])
        before=image_state(image);program=compositor_graph.extract(oracle.scene)
        assert program['status']=='extracted',program
        frames=[]
        for frame_width,frame_height in [(16,8),(17,9),(8,4),(9,5),(18,10),(16,8),(16,8)]:
            frame={'width':frame_width,'height':frame_height,
                'input':np.random.default_rng(frame_width*100+frame_height).uniform(-.5,2,(frame_height,frame_width,4)).astype(np.float32).ravel().tolist()}
            if (frame_width,frame_height)==(18,10):frame.update({'pixelRatio':2,'logicalWidth':9,'logicalHeight':5})
            if bpy.app.version<(5,0) and (frame_width%2 or frame_height%2):
                frame['expectError']='Legacy CPU Static Image preview currently requires even'
            else:
                oracle.scene.render.resolution_x=frame_width;oracle.scene.render.resolution_y=frame_height
                oracle.scene.render.filepath=str(destination/'responsive.exr');bpy.ops.render.render(write_still=True)
                native=bpy.data.images.load(oracle.scene.render.filepath,check_existing=False);native.alpha_mode='PREMUL'
                frame['expected']=list(native.pixels[:]);assert len(frame['expected'])==frame_width*frame_height*4
                bpy.data.images.remove(native)
            frames.append(frame)
        assert image_state(image)==before
        case=oracle.prefix+f'-image-responsive-{width}x{height}'
        (destination/(case+'.json')).write_text(json.dumps({'case':case,'blenderVersion':bpy.app.version_string,
            'blenderHash':bpy.app.build_hash.decode(),'program':program,'resizeFrames':frames,
            'assertShaderCost':{'maxPasses':2,'maxFragmentBytes':100000}}))
        oracle.rows.append({'case':case})
        oracle.scene.render.resolution_x=16;oracle.scene.render.resolution_y=8
    if bpy.app.version<(5,0):
        sink.use_alpha=False;program=compositor_graph.extract(oracle.scene)
        assert program['status']=='extracted' and program['outputAlpha']=='legacy-composite-opaque-v1',program
        opaque_frames=[]
        for frame in frames:
            frame=dict(frame)
            if 'expectError' not in frame:
                oracle.scene.render.resolution_x=frame['width'];oracle.scene.render.resolution_y=frame['height']
                oracle.scene.render.filepath=str(destination/'opaque-responsive.exr');bpy.ops.render.render(write_still=True)
                native=bpy.data.images.load(oracle.scene.render.filepath,check_existing=False);native.alpha_mode='PREMUL'
                frame['expected']=list(native.pixels[:]);assert set(frame['expected'][3::4])=={1}
                bpy.data.images.remove(native)
            opaque_frames.append(frame)
        case=oracle.prefix+'-image-responsive-8x4-opaque'
        (destination/(case+'.json')).write_text(json.dumps({'case':case,'blenderVersion':bpy.app.version_string,
            'blenderHash':bpy.app.build_hash.decode(),'program':program,'resizeFrames':opaque_frames,
            'assertShaderCost':{'maxPasses':2,'maxFragmentBytes':100000}}))
        oracle.rows.append({'case':case})
        oracle.scene.render.resolution_x=16;oracle.scene.render.resolution_y=8
    failures=[]
    for target in ['gpu','filter','mixed-render','different-image','positive-odd-source','missing','sequence','byte-color','animated']:
        sink,unused=oracle.reset();node=tree.nodes.new('CompositorNodeImage');node.image=images[0];output=node.outputs['Image']
        if target=='gpu':oracle.scene.render.compositor_device='GPU'
        elif target=='filter':
            grade=tree.nodes.new('CompositorNodeFilter');tree.links.new(output,grade.inputs['Image']);output=grade.outputs[0]
        elif target in {'mixed-render','different-image'}:
            grade=tree.nodes.new('CompositorNodeAlphaOver')
            tree.links.new(output,grade.inputs['Background' if oracle.modern else 'Image'])
            other=unused.outputs['Image']
            if target=='different-image':
                other_node=tree.nodes.new('CompositorNodeImage');other_node.image=images[1];other=other_node.outputs['Image']
            tree.links.new(other,grade.inputs['Foreground' if oracle.modern else 'Image_001']);output=grade.outputs[0]
        elif target=='positive-odd-source' and bpy.app.version<(5,0):
            odd=bpy.data.images.new('Unsupported odd image',width=7,height=5,alpha=True,float_buffer=True);odd.colorspace_settings.name='Linear Rec.709';node.image=odd
        elif target=='missing':node.image=None
        elif target=='sequence':
            sequence=bpy.data.images.load(str(destination/'authored-png-8x4.png'),check_existing=False);sequence.source='SEQUENCE';node.image=sequence
        elif target=='byte-color':
            data=bpy.data.images.load(str(destination/'authored-png-8x4.png'),check_existing=False);data.colorspace_settings.name='Non-Color';node.image=data
        elif target=='animated':node.keyframe_insert('frame_offset',frame=1)
        else:continue
        tree.links.new(output,sink.inputs[0]);result=compositor_graph.extract(oracle.scene)
        assert result['status']=='unsupported',(target,result)
        failures.append(result['diagnostics']);oracle.scene.render.compositor_device='CPU'
    (destination/'refusals.json').write_text(json.dumps(failures,indent=2))
    # A custom config with familiar names must not silently enter the measured
    # bundled processing profile. This is an admission check, not a color oracle.
    tree.animation_data_clear();sink,unused=oracle.reset();node=tree.nodes.new('CompositorNodeImage');node.image=images[0]
    tree.links.new(node.outputs['Image'],sink.inputs[0])
    bundled=Path(bpy.utils.resource_path('LOCAL'))/'datafiles/colormanagement/config.ocio'
    custom=destination/'unqualified.ocio';custom.write_bytes(bundled.read_bytes()+b'\n# unqualified custom profile\n')
    previous=os.environ.get('OCIO')
    try:
        os.environ['OCIO']=str(custom);before=image_state(node.image)
        result=compositor_graph.extract(oracle.scene)
        assert result['status']=='unsupported' and 'custom OCIO' in str(result) and image_state(node.image)==before,result
    finally:
        if previous is None:os.environ.pop('OCIO',None)
        else:os.environ['OCIO']=previous
    # Execute the copied installed layout, not a bare source import alias.
    node.image=images[6]
    expected=compositor_graph.extract(oracle.scene);before=image_state(node.image)
    assert expected['status']=='extracted',expected
    staged=Path(__file__).resolve().parents[2]/'blendlink/dist/addon'
    helper_source=Path(compositor_graph.__file__).with_name('compositor_image.py')
    assert (staged/'compositor_image.py').read_bytes()==helper_source.read_bytes(),'Build fresh addon assets before the copied-package image probe'
    package_name='isolated_static_image_extension'
    with tempfile.TemporaryDirectory(prefix='blendlink-image-package-') as temporary:
        package=Path(temporary)/package_name;package.mkdir()
        for file in staged.iterdir():
            if file.suffix in {'.py','.json'}:shutil.copy2(file,package/file.name)
        wrapper=types.ModuleType(package_name);wrapper.__path__=[str(package)];sys.modules[package_name]=wrapper
        try:
            qualified=importlib.import_module(package_name+'.compositor_graph')
            assert qualified.normalize_static_image.__module__==package_name+'.compositor_image'
            copied=importlib.import_module(package_name+'.compositor_image')
            assert Path(copied.__file__).parent==package
            actual=qualified.extract(oracle.scene)
            assert actual==expected and image_state(node.image)==before
            for identifier,record in actual['images'].items():
                raw=zlib.decompress(base64.b64decode(record['data']))
                assert len(raw)==record['decodedBytes']==record['width']*record['height']*16
                assert hashlib.sha256(raw+str((record['width'],record['height'],record['source']['storage'])).encode()).hexdigest()==identifier
        finally:
            for name in list(sys.modules):
                if name==package_name or name.startswith(package_name+'.'):sys.modules.pop(name,None)
    files=[Path(__file__),Path(compositor_graph.__file__),Path(compositor_graph.__file__).with_name('compositor_image.py')]
    (destination/'qualification.json').write_text(json.dumps({'native':bpy.app.version_string,'nativeHash':bpy.app.build_hash.decode(),
        'sourcePreserved':True,'copiedPackagePayloadVerified':True,'device':'CPU','cases':len(oracle.rows),
        'sources':{path.name:hashlib.sha256(path.read_bytes()).hexdigest() for path in files}},indent=2))
    oracle.finish('BLENDLINK_COMPOSITOR_IMAGE_PASSED')


output=os.environ.get('BLENDLINK_COMPOSITOR_IMAGE_REFERENCES')
if output:
    destination=Path(output).resolve();destination.mkdir(parents=True,exist_ok=True);main(destination)
else:
    with tempfile.TemporaryDirectory(prefix='blendlink-static-image-') as temporary:main(Path(temporary))
