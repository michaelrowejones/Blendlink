# SPDX-License-Identifier: GPL-3.0-or-later
MODES = ['ADD','SUBTRACT','MULTIPLY','MULTIPLY_ADD','DIVIDE','SCALE','CROSS_PRODUCT','DOT_PRODUCT','MINIMUM','MAXIMUM','ABSOLUTE','FLOOR','CEIL','FRACTION','ROUND','SIGN']
SIMPLE_MODES = ['ADD','SUBTRACT','MULTIPLY','SCALE','MINIMUM','MAXIMUM','ABSOLUTE','FLOOR','CEIL','FRACTION','ROUND','SIGN']
POINTS = [([.5,-.25,.125],[2,-.5,4]),([-16,16,-.0625],[.0625,-16,8]),([15.9375,-15.9375,8],[.125,8,-.25]),([1,-1,1],[-1,1,-1]),([0,0,0],[0,0,0]),([.5,1.5,2.5],[1,2,4]),([-.5,-1.5,-2.5],[1,2,4]),([-.0625,.0625,15.9375],[-.0625,.0625,2])]

def signatures():
    result=[]
    for mode in MODES:
        for i,(a,b) in enumerate(POINTS):
            a=list(a)
            if mode=='CEIL':
                a=[x-1 if -1<x<0 else x for x in a]
            scale=0 if i==4 else [-2,.0625,16,1,0,.5,-.5,2][i]
            result.append({'case':mode.lower()+'-'+str(i),'mode':mode,'a':a,'b':b,'c':[.0625,-.5,1],'scale':scale,'route':'default','saved':i==0})
    for route in ['direct','reroute','combine','group']:
        result.append({'case':'add-'+route,'mode':'ADD','a':[.5,-.25,.125],'b':[2,-.5,4],'c':[0,0,0],'scale':1,'route':route,'saved':True})
    wide_points = [([.1,.8,1/3],[.2,-.1,2/3],.1),([.4999999701976776,.5000000596046448,.5],[-.5000000596046448,-.4999999701976776,-.5],.8),([2**16,-2**16,2**-32],[2**-32,-2**16,2**16],2**16),([1,-1,0],[-1,1,0],0),([-2**-32,2**-32,-.1],[2**-32,2**-32,.8],2**-32),([65535.99609375,2.3283067140944524e-10,1.0000001192092896],[.1,.8,1/3],1/3)]
    for mode in SIMPLE_MODES:
        for i,(a,b,scale) in enumerate(wide_points):
            a=list(a)
            if mode=='CEIL':a=[x-1 if -1<x<0 else x for x in a]
            if mode=='SCALE' and i==3:a=[1,1,0]
            result.append({'case':mode.lower()+'-wide-'+str(i),'mode':mode,'a':a,'b':b,'c':[0,0,0],'scale':scale,'route':'default','saved':i==0})
    return result
