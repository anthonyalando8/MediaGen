// packages/effects/src/glsl/default.vert.ts
//
// Pixi's own default filter vertex shader, verbatim (same source
// renderer-webgl/src/passes/pass-resolver.ts already uses for the identity
// pass — copied from pixi.js/lib/filters/defaults/defaultFilter.vert.js).
// Every effect/transition fragment shader in this package pairs with this
// SAME vertex stage; only the fragment shader differs per effect.

export const DEFAULT_VERTEX = `in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition( void )
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;

    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0*uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;

    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord( void )
{
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void)
{
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
}
`;