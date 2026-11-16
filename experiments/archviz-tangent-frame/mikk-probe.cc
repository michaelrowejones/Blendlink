/* SPDX-License-Identifier: Apache-2.0
 * Independent test adapter for the pinned Apache MikkTSpace header API.
 * No Blender draw/kernel implementation is copied or linked here. */
#include <array>
#include <atomic>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <iomanip>
#include <iostream>
#include <vector>
using uint = unsigned int;
#define LIKELY(x) (x)
#define UNLIKELY(x) (x)
#include "mikktspace.hh"
struct Corner {uint id; mikk::float3 p,n,uv,t;float sign=0;};
struct Mesh {
 std::vector<std::vector<Corner>> faces;
 uint GetNumFaces(){return uint(faces.size());}
 uint GetNumVerticesOfFace(uint face){return uint(faces[face].size());}
 mikk::float3 GetPosition(uint face,uint corner){return faces[face][corner].p;}
 mikk::float3 GetNormal(uint face,uint corner){return faces[face][corner].n;}
 mikk::float3 GetTexCoord(uint face,uint corner){return faces[face][corner].uv;}
 bool has_uv()const{return true;}
 void SetTangentSpace(uint face,uint corner,mikk::float3 tangent,bool orientation){faces[face][corner].t=tangent;faces[face][corner].sign=orientation?1:-1;}
};
int main(){
 uint count;if(!(std::cin>>count))return 2;Mesh mesh;mesh.faces.resize(count);
 for(auto&face:mesh.faces){uint corners;std::cin>>corners;if(corners!=3&&corners!=4)return 3;face.resize(corners);for(auto&c:face){std::cin>>c.id>>c.p.x>>c.p.y>>c.p.z>>c.n.x>>c.n.y>>c.n.z>>c.uv.x>>c.uv.y;c.uv.z=1;}}
 if(!std::cin)return 4;
 mikk::Mikktspace<Mesh> evaluator(mesh);evaluator.genTangSpace();
 std::cout<<std::setprecision(9);
 for(const auto&face:mesh.faces)for(const auto&c:face)std::cout<<c.id<<' '<<c.t.x<<' '<<c.t.y<<' '<<c.t.z<<' '<<c.sign<<'\n';
}
