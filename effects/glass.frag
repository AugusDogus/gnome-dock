// Frosted glass: Lisse-style squircle mask + tint over pre-blurred clone texture.
//
// The corner curve is the Figma/Lisse construction — cubic shoulder + circular
// arc + cubic shoulder — not a superellipse. The JS side (effects/glassEffect.js)
// ports Lisse's getPathParamsForCorner and feeds the per-corner parameters
// (radius, p_ext, lpa..lpd, asl) as uniforms; here we fold each fragment into a
// canonical corner frame and find the signed distance to that exact curve.
uniform sampler2D cogl_sampler;

uniform float resolution_x;
uniform float resolution_y;
uniform float edge_smoothing;
uniform float tint_strength;
uniform float tint_r;
uniform float tint_g;
uniform float tint_b;
uniform float padding;
uniform float isDock;

// Legibility controls: backdrop saturation boost, inner-rim highlight, and a
// soft outer drop shadow painted into the transparent padding. Together these
// give the slab a defined edge on both dark and light backgrounds, so a single
// static tint reads on either.
uniform float saturation;
uniform float highlight_strength;
uniform float shadow_strength;

// Lisse corner parameters (pixels), computed JS-side from radius + smoothing.
uniform float radius;
uniform float p_ext;
uniform float lpa;
uniform float lpb;
uniform float lpc;
uniform float lpd;
uniform float asl;

vec2 cubicBezier(vec2 p0, vec2 p1, vec2 p2, vec2 p3, float t) {
    float u = 1.0 - t;
    return ((u * u * u) * p0)
         + (3.0 * (u * u) * t * p1)
         + (3.0 * u * (t * t) * p2)
         + ((t * t * t) * p3);
}

void cubicMin(vec2 P, vec2 p0, vec2 p1, vec2 p2, vec2 p3,
              inout float minD2, inout vec2 closest) {
    float bestT = 0.0;
    float bestD2 = 1e30;
    vec2 bestPt = p0;

    for (int i = 0; i <= 32; i++) {
        float t = float(i) / 32.0;
        vec2 pt = cubicBezier(p0, p1, p2, p3, t);
        vec2 dv = P - pt;
        float d2 = dot(dv, dv);
        if (d2 < bestD2) {
            bestD2 = d2;
            bestT = t;
            bestPt = pt;
        }
    }

    float tLow = max(0.0, bestT - 1.0 / 32.0);
    float tHigh = min(1.0, bestT + 1.0 / 32.0);

    for (int i = 0; i <= 32; i++) {
        float t = mix(tLow, tHigh, float(i) / 32.0);
        vec2 pt = cubicBezier(p0, p1, p2, p3, t);
        vec2 dv = P - pt;
        float d2 = dot(dv, dv);
        if (d2 < bestD2) {
            bestD2 = d2;
            bestPt = pt;
        }
    }

    if (bestD2 < minD2) {
        minD2 = bestD2;
        closest = bestPt;
    }
}

void arcMin(vec2 P, inout float minD2, inout vec2 closest) {
    vec2 C = vec2(radius, radius);
    vec2 v1 = vec2(lpd + asl - radius, lpd - radius);
    vec2 v2 = vec2(lpd - radius, lpd + asl - radius);

    float a1 = atan(v1.y, v1.x);
    float a2 = atan(v2.y, v2.x);
    float delta = a2 - a1;
    if (delta > 3.14159265)
        delta -= 6.28318530;
    else if (delta < -3.14159265)
        delta += 6.28318530;

    float bestD2 = 1e30;
    vec2 bestPt = C;

    for (int i = 0; i <= 64; i++) {
        float t = float(i) / 64.0;
        float ang = a1 + delta * t;
        vec2 pt = C + radius * vec2(cos(ang), sin(ang));
        vec2 dv = P - pt;
        float d2 = dot(dv, dv);
        if (d2 < bestD2) {
            bestD2 = d2;
            bestPt = pt;
        }
    }

    if (bestD2 < minD2) {
        minD2 = bestD2;
        closest = bestPt;
    }
}

// Signed distance from P (folded corner coords: P.x = distance from the side
// edge, P.y = distance from the top/bottom edge; (0,0) is the rect's outer
// corner, the interior lies toward (p_ext, p_ext)) to the Lisse corner curve.
// Negative inside, positive outside.
float cornerSDF(vec2 P) {
    float minD2 = 1e30;
    vec2 closest = vec2(0.0);

    cubicMin(P,
        vec2(p_ext, 0.0),
        vec2(p_ext - lpa, 0.0),
        vec2(p_ext - lpa - lpb, 0.0),
        vec2(lpd + asl, lpd),
        minD2, closest);

    arcMin(P, minD2, closest);

    cubicMin(P,
        vec2(lpd, lpd + asl),
        vec2(0.0, lpd + asl + lpc),
        vec2(0.0, lpd + asl + lpb + lpc),
        vec2(0.0, p_ext),
        minD2, closest);

    // The Lisse corner is monotonic from (p, 0) to (0, p): fragments near the
    // rect corner have a smaller x+y than the boundary and sit outside;
    // fragments toward the interior have a larger x+y and sit inside.
    float sign_val = sign((closest.x + closest.y) - (P.x + P.y));
    return sqrt(minD2) * sign_val;
}

// Signed distance to the rounded squircle. `pos` is relative to the box center,
// `b` is the box half-extent. Straight edges use a plain box SDF; the four
// corner windows fall back to the exact Lisse curve. Negative inside.
float sdSquircle(vec2 pos, vec2 b) {
    vec2 pp = abs(pos);
    vec2 q = pp - b;
    float boxSD = min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0)));

    if (p_ext <= 0.5)
        return boxSD;

    vec2 ed = b - pp;
    float cornerSD = cornerSDF(ed);

    // Compose the straight-edge box field with the exact Lisse corner field.
    // The previous hard switch introduced a rectangular seam where the two
    // fields met; `max()` keeps the same zero set while making the magnitude
    // continuous across the corner-window boundary.
    return max(boxSD, cornerSD);
}

void main() {
    vec2 resolution = vec2(resolution_x, resolution_y);
    vec2 uv = cogl_tex_coord_in[0].st;
    vec2 pixel_coord = uv * resolution;
    vec2 center = resolution * 0.5;

    float edgeFeather = max(edge_smoothing, 0.75);
    vec2 local_pos = pixel_coord - center;
    vec2 box_size;

    if (isDock > 0.5) {
        vec2 actual_size = resolution - vec2(padding * 2.0) - vec2(edgeFeather * 2.0);
        box_size = max(actual_size * 0.5, vec2(1.0));
    } else {
        vec2 actual_size = resolution - vec2(padding * 2.0);
        box_size = max(actual_size * 0.5, vec2(1.0));
    }

    float d = sdSquircle(local_pos, box_size);
    float insideMask = smoothstep(edgeFeather, -edgeFeather, d);

    // Oversaturate the backdrop so colors read through the glass instead of
    // washing out to gray. saturation == 1.0 is a no-op.
    vec3 blurred = texture2D(cogl_sampler, uv).rgb;
    float luma = dot(blurred, vec3(0.2126, 0.7152, 0.0722));
    blurred = clamp(mix(vec3(luma), blurred, saturation), 0.0, 1.0);

    vec3 tintColor = vec3(tint_r, tint_g, tint_b);
    vec3 bodyColor = mix(blurred, tintColor, tint_strength);

    // Inner-rim highlight: a thin bright line hugging the inside edge. This is
    // what separates the panel from a dark background.
    float rimWidth = edgeFeather + 2.0;
    float rim = insideMask * smoothstep(-rimWidth, 0.0, d);
    bodyColor = mix(bodyColor, vec3(1.0), rim * highlight_strength);

    // Outer drop shadow: a soft dark halo in the positive-distance padding
    // region (currently fully transparent). This separates the panel from a
    // light background. Shadow color is black, so it adds no premultiplied RGB.
    float shadowWidth = max(padding - 4.0, 1.0);
    float shadowAlpha = shadow_strength *
        smoothstep(shadowWidth, 0.0, d) * (1.0 - insideMask);

    // Premultiplied over-composite of the glass body atop the shadow.
    float outAlpha = insideMask + shadowAlpha * (1.0 - insideMask);
    vec3 outColor = bodyColor * insideMask;

    cogl_color_out = vec4(outColor, outAlpha) * cogl_color_in;
}
