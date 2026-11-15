import{replay}from'./transport.mjs'
const{results,...report}=await replay();console.log(JSON.stringify(report,null,2))
