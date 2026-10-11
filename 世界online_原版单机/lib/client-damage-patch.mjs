export const damageMathRevision='wide-product-v1';

// v305 converts the numerator to int32 before dividing by 10,000. A 500,000
// hit wraps 5,000,000,000 to 705,032,704 and becomes only 70,503 damage.
// Keep that product as a Number; the original final division, integer result,
// minimum damage, RNG order, armor, critical hits and reductions stay intact.
// The client's bounded attack values keep these integer products below 2^53.
export function patchBattleDamageMath(source){
  const products=[
    ['slashing','h=g.GUtil.intNum((100-u)*_*d)','h=Math.trunc((100-u)*_*d)'],
    ['piercing','N=g.GUtil.intNum((100-P)*R*O)','N=Math.trunc((100-P)*R*O)'],
    ['magic','D=g.GUtil.intNum((100-w)*b*x)','D=Math.trunc((100-w)*b*x)']
  ];
  for(const [kind,from,to] of products){
    if(source.split(from).length!==2)throw Error('v305 damage patch mismatch: '+kind);
    source=source.replace(from,to);
  }
  return source;
}
