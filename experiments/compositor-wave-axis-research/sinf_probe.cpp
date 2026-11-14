// SPDX-License-Identifier: MIT
// Public libm query for one retained argument; no Blender function body copied.
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
int main(){
 uint32_t word=0x4308a8d7;float argument;std::memcpy(&argument,&word,4);
 volatile float storedArgument=argument;float (*volatile nativeSine)(float)=::sinf;
 float native=nativeSine(storedArgument),roundedDouble=static_cast<float>(::sin(static_cast<double>(storedArgument)));
 float halfNative=0.5f*native,nativeFactor=0.5f+halfNative;
 float halfDouble=0.5f*roundedDouble,doubleFactor=0.5f+halfDouble;
 auto emit=[](const char *name,float value){uint32_t bits;std::memcpy(&bits,&value,4);std::printf("%s %08x %.17g\n",name,bits,static_cast<double>(value));};
 emit("argument",argument);emit("nativeSinf",native);emit("roundedDoubleSin",roundedDouble);emit("nativeFactor",nativeFactor);emit("doubleFactor",doubleFactor);
}
