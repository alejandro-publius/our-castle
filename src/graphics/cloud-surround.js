// Code-native cloud banks around the playable woodland. No images, particles or extra draw pass.
export const CLOUD_SURROUND_GLSL = `
uniform bool cloudSurroundEnabled;
uniform float cloudTime;
uniform vec2 cloudBounds;
uniform mat4 cloudWorldFromClip;
uniform vec3 cloudLight;
uniform vec3 cloudShade;
uniform vec3 cloudBase;
uniform vec3 cloudRight;
uniform vec3 cloudUp;

vec2 cloudHash(vec2 p) {
  vec3 q=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));
  q+=dot(q,q.yzx+33.33);
  return fract((q.xx+q.yz)*q.zy);
}
float cloudPuff(vec2 q) {
  float h=clamp(1.0-dot(q,q),0.0,1.0);
  return h*h*(3.0-2.0*h);
}
float cloudBank(vec2 p) {
  vec2 cell=floor(p); float mass=0.0;
  for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++) {
    vec2 tile=cell+vec2(float(i),float(j)),r=cloudHash(tile);
    vec2 q=p-tile-.5-(r-.5)*.62;
    float body=cloudPuff(q/vec2(.68,.54));
    float left=cloudPuff((q-vec2(-.38,.1))/vec2(.45,.43));
    float right=cloudPuff((q-vec2(.39,.16))/vec2(.46,.45));
    mass+=max(body,max(left*.96,right))*(.65+.35*r.x);
  }
  return 1.0-exp(-mass*.94);
}
// RGB is already in display space, like the world colour after the renderer's filmic pass.
// Alpha is only a compositing weight: sky is replaced; foreground haze reaches only the outer trees.
vec4 cloudSurroundAt(vec2 uv,float depth) {
  if(!cloudSurroundEnabled)return vec4(0.0);
  vec4 a=cloudWorldFromClip*vec4(uv*2.0-1.0,-1.0,1.0);
  vec4 b=cloudWorldFromClip*vec4(uv*2.0-1.0,1.0,1.0);
  vec3 from=a.xyz/a.w,to=b.xyz/b.w;
  bool sky=depth>=.99999;
  vec3 world=sky?mix(from,to,(.25-from.y)/(to.y-from.y)):mix(from,to,depth);
  vec2 edge=abs(world.xz)-cloudBounds;
  float distance=length(max(edge,vec2(0.0)))+min(max(edge.x,edge.y),0.0);
  if(!sky&&distance<-4.2)return vec4(0.0);
  vec2 p=vec2(dot(world,cloudRight),dot(world,cloudUp))/31.0+vec2(cloudTime*.003,cloudTime*.0018);
  float billow=cloudBank(p),veil=cloudBank(p*.46+vec2(19.7,-8.4));
  float light=smoothstep(.12,.78,billow*.78+veil*.34);
  vec3 colour=mix(cloudShade,cloudLight,light);
  colour=mix(cloudBase,colour,.45+veil*.5);
  float alpha=sky?1.0:smoothstep(-2.2-billow*1.4,.8,distance)*(.20+billow*.98);
  if(!sky)alpha*=1.0-smoothstep(2.0,7.0,world.y)*.42;
  return vec4(colour,alpha);
}
`;

export function cloudColours(period = 'day', weather = 'clear') {
  const wet = weather === 'rain' || weather === 'overcast';
  if (period === 'night') return wet ? [0x87958c, 0x39463f, 0x59685f] : [0xaab5a9, 0x455348, 0x718071];
  if (wet) return [0xd6d9cd, 0x9ca99e, 0xbdc5b9];
  if (period === 'afternoon') return [0xf3e3c5, 0xc0b8a3, 0xe1d8c2];
  return [0xf6f0e2, 0xc1c9bb, 0xe1e6d8];
}
