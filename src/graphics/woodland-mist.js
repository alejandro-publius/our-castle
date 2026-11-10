// Local, low forest haze, composed after the preserved art palette alongside the
// surrounding clouds. Reconstructed scene depth keeps it in the two outer groves.
// No texture, particle allocation, new render pass or independent animation loop.
export const WOODLAND_MIST_GLSL = `
uniform vec4 woodlandMistGroves[2];
vec4 woodlandMistAt(vec2 uv,float depth) {
  if(!cloudSurroundEnabled || depth>=.99999)return vec4(0.0);
  vec4 point=cloudWorldFromClip*vec4(uv*2.0-1.0,depth*2.0-1.0,1.0);
  vec3 world=point.xyz/point.w;
  float coverage=0.0;
  for(int i=0;i<2;i++) {
    vec4 grove=woodlandMistGroves[i];
    vec2 local=(world.xz-grove.xy)/grove.zw;
    float pocket=1.0-smoothstep(.35,1.0,length(local));
    float wisp=.65+.20*sin(world.x*.31+world.z*.12+cloudTime*.10)
      +.15*sin(world.z*.48-world.x*.17-cloudTime*.07);
    coverage=max(coverage,pocket*wisp);
  }
  float low=1.0-smoothstep(2.0,12.0,world.y);
  return vec4(mix(cloudShade,cloudBase,.7),coverage*low*.35);
}
`;
