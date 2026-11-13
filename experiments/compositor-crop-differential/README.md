# Native Crop domain research

No live Crop implementation is admitted by this experiment. It records actual
CPU/GPU EXR output, authored controls, requested controls, compiler refusal,
native build identity, input bytes and the executed fixture hash.

The primary source references are pinned to the tested releases:

- [Legacy CPU crop](https://github.com/blender/blender/blob/v4.2.0/source/blender/compositor/operations/COM_CropOperation.cc)
- [Legacy RNA mapping](https://github.com/blender/blender/blob/v4.2.0/source/blender/makesrna/intern/rna_nodetree.cc)
- [Modern 5.2 crop](https://github.com/blender/blender/blob/v5.2.0/source/blender/nodes/composite/nodes/node_composite_crop.cc)
- [Modern 5.3 crop](https://github.com/blender/blender/blob/v5.3.0/source/blender/nodes/composite/nodes/node_composite_crop.cc)

Initial observations:

- Legacy RNA names `min_y`/`max_y` bind upper/lower boundaries respectively.
  Relative fields follow the same order. The earlier `domains42-cpu` report
  retains the reversed-Y controls; it is not a successful intended-rectangle
  test and predates the explicit fixture hash.
- Transparent masking preserves the input canvas. Cropping its size changes
  terminal realization; it cannot be replaced by a mask in every mode.
- Legacy CPU/GPU odd cropped extents disagree visibly, including a one-pixel
  crop. Empty crop-size output differs too. Even extents and transparent-mask
  modes need separate positive controls before promotion.
- Modern output clamps/intersects the authored rectangle; zero Width still
  produces a one-pixel-wide region in the tested releases. Do not infer this
  from the current development branch, which has a different empty-bound path.
- Modern CPU/GPU crop-size terminal interpolation has small measured rounding
  differences. Transparent-mask cases matched exactly in the initial corpus.

Run with `BLENDLINK_CROP_EVIDENCE=/absolute/output`, optional
`BLENDLINK_CROP_DEVICE=GPU`, and a pinned Blender executable using
`--background --factory-startup --python-exit-code 1 --python
experiments/compositor-crop-differential/native_domains.py`.
