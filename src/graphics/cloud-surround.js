// Original code-native cumulus around the woodland. No images, particles or extra draw pass.
export const CLOUD_SURROUND_GLSL = `
uniform bool cloudSurroundEnabled;
uniform float cloudTime;
uniform vec2 cloudBounds;
uniform vec2 cloudCenter;
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
// Distance and light on one rounded lobe. Soft union preserves a scalloped silhouette, not a blurred noise field.
vec2 cloudLobe(vec2 p,vec2 radius) {
  vec2 q=p/radius;
  float len=length(q);
  float light=clamp(.77+q.y*.23-q.x*.14+sqrt(max(0.0,1.0-dot(q,q)))*.08,.32,1.0);
  return vec2((len-1.0)*min(radius.x,radius.y),light);
}
vec2 cloudJoin(vec2 a,vec2 b) {
  float h=clamp(.5+.5*(b.x-a.x)/.10,0.0,1.0);
  return vec2(mix(b.x,a.x,h)-.10*h*(1.0-h),mix(b.y,a.y,h));
}
vec2 cloudCrown(vec2 q,float seed) {
  vec2 s=cloudLobe(q-vec2(0.0,-.18),vec2(1.16+seed*.12,.40));
  s=cloudJoin(s,cloudLobe(q-vec2(-.58,.02),vec2(.36+seed*.16,.34+seed*.1)));
  s=cloudJoin(s,cloudLobe(q-vec2(-.20,.16+seed*.24),vec2(.42+seed*.12,.44+seed*.22)));
  s=cloudJoin(s,cloudLobe(q-vec2(.35,.06+seed*.14),vec2(.51,.33+(1.0-seed)*.22)));
  return cloudJoin(s,cloudLobe(q-vec2(.76,-.10),vec2(.37,.25+seed*.08)));
}
vec4 cloudBank(vec2 p) {
  vec2 spacing=vec2(2.4,.95),cell=floor(p/spacing);
  vec3 colour=mix(cloudBase,cloudLight,.86);
  float coverage=0.0;
  for(int j=2;j>=-2;j--)for(int i=-1;i<=1;i++) {
    vec2 tile=cell+vec2(float(i),float(j)),r=cloudHash(tile),form=cloudHash(tile+vec2(17.3,9.2));
    vec2 centre=(tile+.5)*spacing+(r-.5)*vec2(.65,.20);
    vec2 q=(p-centre)/vec2(1.25+form.x*.45,1.35+form.y*.50);
    q.x*=form.y>.5?-1.0:1.0;
    vec2 shape=cloudCrown(q,r.y);
    float body=1.0-smoothstep(-.008,.032,shape.x);
    float halo=1.0-smoothstep(.015,.13,shape.x);
    float wisp=1.0-smoothstep(-.01,.065,cloudLobe(q-vec2(.32,-.49),vec2(1.48,.12)).x);
    // Overlapping rows form one cloud bed. Pale under-cloud light replaces exposed flat background.
    colour=mix(colour,cloudShade,halo*.16);
    colour=mix(colour,mix(cloudBase,cloudLight,.82),wisp*.22);
    vec3 bodyColour=mix(mix(cloudShade,cloudLight,.45),cloudLight,smoothstep(.30,.95,shape.y));
    colour=mix(colour,bodyColour,body*.98);
    coverage=max(coverage,max(body,wisp*.25));
  }
  return vec4(colour,coverage);
}
// Display-space composition after the world's original palette. Haze only brushes the outer forest edge.
vec4 cloudSurroundAt(vec2 uv,float depth) {
  if(!cloudSurroundEnabled)return vec4(0.0);
  vec4 a=cloudWorldFromClip*vec4(uv*2.0-1.0,-1.0,1.0);
  vec4 b=cloudWorldFromClip*vec4(uv*2.0-1.0,1.0,1.0);
  vec3 from=a.xyz/a.w,to=b.xyz/b.w;
  bool sky=depth>=.99999;
  vec3 world=sky?mix(from,to,(.25-from.y)/(to.y-from.y)):mix(from,to,depth);
  vec2 edge=abs(world.xz-cloudCenter)-cloudBounds;
  float distance=length(max(edge,vec2(0.0)))+min(max(edge.x,edge.y),0.0);
  if(!sky&&distance<-3.2)return vec4(0.0);
  vec2 p=vec2(dot(world,cloudRight),dot(world,cloudUp))/24.0+vec2(cloudTime*.003,cloudTime*.0018);
  vec4 cloud=cloudBank(p);
  float alpha=sky?1.0:smoothstep(-2.2,.7,distance)*(.055+cloud.a*.25);
  if(!sky)alpha*=1.0-smoothstep(2.0,7.0,world.y)*.42;
  return vec4(cloud.rgb,alpha);
}
`;

export function cloudColours(period = 'day', weather = 'clear') {
  const wet = weather === 'rain' || weather === 'overcast';
  if (period === 'night') return wet ? [0xd0dfe2, 0x90a6ae, 0x6f7f84] : [0xe3eceb, 0xa6bac0, 0x839595];
  if (wet) return [0xf5f7f0, 0xb9c9ca, 0xd8e3df];
  if (period === 'afternoon') return [0xfff8e5, 0xd4c0ad, 0xeee3cc];
  return [0xfffff6, 0xc2d3d3, 0xe2eada];
}
