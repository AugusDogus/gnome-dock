// Liquid glass: Lisse-style squircle silhouette + real refraction.
//
// The silhouette (the mask that defines the panel shape and antialiased edge)
// is the exact Figma/Lisse corner construction — cubic shoulder + circular arc
// + cubic shoulder — fed from JS as per-corner parameters (radius, p_ext,
// lpa..lpd, asl). On top of that silhouette we run a physically motivated glass
// pipeline ported from ryohsuke1231/liquid-glass + liquid-dom: a concave bezel
// profile builds an edge-localized lip, its gradient gives a normal, Snell's-law refraction
// displaces the backdrop UV (the lensing "break" that separates the panel from
// content behind it), with chromatic aberration, rotated-grid supersampling,
// and Fresnel rim / specular / sheen lighting.
//
// The height field / refraction uses a cheap rounded-rect distance for speed;
// the visible silhouette stays the exact Lisse curve, so the squircle corners
// are preserved while the heavy per-pixel work avoids the Bezier minimizer.
uniform sampler2D cogl_sampler;

uniform float resolution_x;
uniform float resolution_y;
uniform float edge_smoothing;
uniform float padding;
uniform float isDock;

// Material mode. Clear glass uses a subtle white tint; dark glass uses a
// stronger smoky tint. The rest of the optical model is intentionally hardcoded
// so the dock keeps one coherent material instead of exposing dozens of ways to
// make it look cheap.
uniform float dark_tint;
uniform float saturation;

// Refraction / surface profile.
uniform float corner_radius;       // rounded-rect radius for the height field
uniform float displacement_scale;  // strength of the refraction distortion
uniform float ior;                 // index of refraction
uniform float chroma_strength;     // chromatic aberration

// Lisse corner parameters (pixels), computed JS-side from radius + smoothing.
uniform float radius;
uniform float p_ext;
uniform float lpa;
uniform float lpb;
uniform float lpc;
uniform float lpd;
uniform float asl;

/* ----------------------------------------------------------------------- *
 * Lisse squircle silhouette (exact Figma/Lisse corner curve).
 * ----------------------------------------------------------------------- */

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

    float sign_val = sign((closest.x + closest.y) - (P.x + P.y));
    return sqrt(minD2) * sign_val;
}

float sdSquircle(vec2 pos, vec2 b) {
    vec2 pp = abs(pos);
    vec2 q = pp - b;
    float boxSD = min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0)));

    if (p_ext <= 0.5)
        return boxSD;

    vec2 ed = b - pp;
    float cornerSD = cornerSDF(ed);
    return max(boxSD, cornerSD);
}

/* ----------------------------------------------------------------------- *
 * Refraction surface (cheap rounded-rect height field).
 * Ported from ryohsuke1231/liquid-glass shaders/glass.frag.
 * ----------------------------------------------------------------------- */

float sdRoundRect(vec2 p, vec2 b, float r) {
    vec2 d = abs(p) - b + vec2(r);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - r;
}

// Surface profile functions, ported verbatim from liquid-dom
// (packages/core/src/shaders.ts). `x` is a bezel coordinate in [0,1]: 0 is the
// outer edge, 1 is the inner edge of the bezel band. The bend lives entirely in
// this band; the interior stays flat. .x is height, .y is the analytic slope.
vec2 convexSquircle(float x) {
    float u = 1.0 - clamp(x, 0.0, 1.0);
    float inside = max(1.0 - pow(u, 4.0), 0.0001);
    float height = sqrt(inside);
    float deriv = 2.0 * pow(u, 3.0) / sqrt(inside);
    return vec2(height, deriv);
}

vec2 concaveCircle(float x) {
    vec2 s = convexSquircle(x);
    return vec2(1.0 - s.x, -s.y);
}

// Hardcoded concave profile: a raised lip at the rim that lenses the backdrop
// near the edge and leaves the interior undistorted. liquid-dom exposes
// convex/concave/lip; concave gives the cleanest edge separation on busy
// backgrounds, which is the look we want for the dock.
vec2 evaluateHeightProfile(float x) {
    return concaveCircle(x);
}

// Bezel band width in pixels. liquid-dom uses max(configuredBezel, 2px); we
// tie it to the corner radius so the lens band scales with the rounding, then
// clamp so it never exceeds the panel half-size.
float bezelWidthFor(vec2 b) {
    float maxBezel = max(min(b.x, b.y), 1.0);
    return clamp(corner_radius, 8.0, maxBezel);
}

// SDF gradient (outward direction), via 1px finite differences. liquid-dom
// reads this from its scene SDF sample; the rounded-rect SDF here is a true
// distance field, so its gradient has unit length and points away from the
// interior. This is the direction the analytic bevel slope is applied along.
vec2 sdRoundRectGrad(vec2 p, vec2 b, float r) {
    float e = 1.0;
    return vec2(
        sdRoundRect(p + vec2(e, 0.0), b, r) - sdRoundRect(p - vec2(e, 0.0), b, r),
        sdRoundRect(p + vec2(0.0, e), b, r) - sdRoundRect(p - vec2(0.0, e), b, r)
    ) / (2.0 * e);
}

// Refraction displacement (UV space). The surface normal is built by the caller
// from the ANALYTIC bevel slope (liquid-dom), not a finite difference of the
// height field. `surfaceHeight` is the normalized profile height in [0,1] and
// scales the displacement; `displacement_scale` governs the overall magnitude.
vec2 getDisplacement(float d, vec3 normal, float surfaceHeight, vec2 resolution) {
    if (d > 0.0)
        return vec2(0.0);

    vec3 viewDir = vec3(0.0, 0.0, -1.0);
    float eta = 1.0 / max(ior, 1.001);
    vec3 refractedRay = refract(viewDir, normal, eta);

    if (length(refractedRay) < 0.0001)
        return vec2(0.0);

    float minRes = max(min(resolution.x, resolution.y), 1.0);
    float thicknessNorm = (displacement_scale / minRes) * surfaceHeight;

    float safe_z = max(-refractedRay.z, 0.15);
    vec2 displacement = (refractedRay.xy / safe_z) * thicknessNorm;
    float max_disp = 0.14;
    if (length(displacement) > max_disp)
        displacement = normalize(displacement) * max_disp;

    return displacement;
}

vec2 stabilizedUV(vec2 candidate, vec2 fallback) {
    vec2 clamped = clamp(candidate, vec2(0.001), vec2(0.999));
    float edgeDist = min(min(candidate.x, candidate.y),
                         min(1.0 - candidate.x, 1.0 - candidate.y));
    float keep = smoothstep(-0.04, 0.03, edgeDist);
    return mix(fallback, clamped, keep);
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

    // Silhouette: exact Lisse squircle defines the shape and antialiased edge.
    float dMask = sdSquircle(local_pos, box_size);
    float insideMask = smoothstep(edgeFeather, -edgeFeather, dMask);

    // Refraction surface: rounded-rect SDF + analytic concave bezel profile.
    // The bend is the analytic profile slope mapped onto the SDF gradient
    // direction (liquid-dom), so the interior stays flat and only the bezel band
    // refracts. This is what avoids the embossed double-edge that finite-
    // differencing a concave height field (max height right at the rim) created.
    float dSurf = sdRoundRect(local_pos, box_size, corner_radius);

    float bezelWidth = bezelWidthFor(box_size);
    float inwardDistance = max(-dSurf, 0.0);
    float bezelProgress = clamp(inwardDistance / bezelWidth, 0.0, 1.0);
    float beyondBezel = step(bezelWidth, inwardDistance);

    vec2 profile = evaluateHeightProfile(bezelProgress);
    float surfaceDerivative = mix(profile.y, 0.0, beyondBezel);
    float slopeMax = tan(1.4835298);   // liquid-dom: clamp to ~85 degrees
    float clampedSlope = clamp(surfaceDerivative, -slopeMax, slopeMax);

    vec2 sdfGradDir = normalize(sdRoundRectGrad(local_pos, box_size, corner_radius)
        + vec2(1e-6));
    vec3 normal = normalize(vec3(sdfGradDir * clampedSlope, 1.0));

    float surfaceHeight = mix(profile.x, evaluateHeightProfile(1.0).x, beyondBezel);

    vec2 disp = getDisplacement(dSurf, normal, surfaceHeight, resolution);
    vec2 refractedUv = stabilizedUV(uv + disp, uv);

    float minRes = max(min(resolution.x, resolution.y), 1.0);
    vec2 chromaDir = length(disp) > 0.00001 ? normalize(disp) : vec2(0.0);
    vec2 chromaVec = chromaDir * (chroma_strength / minRes) * surfaceHeight;
    vec2 uvR = stabilizedUV(refractedUv + chromaVec, refractedUv);
    vec2 uvG = refractedUv;
    vec2 uvB = stabilizedUV(refractedUv - chromaVec, refractedUv);

    // Rotated-grid supersampling for clean edges on high-frequency backdrops.
    float edgeProximity = 1.0 - smoothstep(0.0, edgeFeather * 4.0, -dSurf);
    float aa_spread = mix(0.75, 2.5, edgeProximity);
    vec2 texel = vec2(aa_spread) / resolution;

    vec2 off1 = vec2( 0.375, -0.125) * texel;
    vec2 off2 = vec2( 0.125,  0.375) * texel;
    vec2 off3 = vec2(-0.375,  0.125) * texel;
    vec2 off4 = vec2(-0.125, -0.375) * texel;

    // Clamp every backdrop sample to the dock's own footprint, inset past the
    // blur fringe. A bottom-anchored dock has no real content below it: the
    // padding/off-screen region of the cloned backdrop is empty (black), and the
    // ACTOR-mode blur bleeds that black inward. Outward edge refraction would
    // otherwise pull that black in as a hard dark bevel, so we never sample
    // beyond the box. The 9px inset skips the blurred black fringe at the edge.
    vec2 boxMinUV = (center - box_size) / resolution;
    vec2 boxMaxUV = (center + box_size) / resolution;
    vec2 sampleInset = vec2(9.0) / resolution;
    vec2 sampleMin = min(boxMinUV + sampleInset, vec2(0.5));
    vec2 sampleMax = max(boxMaxUV - sampleInset, vec2(0.5));
    #define SAFE(u) clamp(u, sampleMin, sampleMax)

    vec3 refractedRgb = vec3(
        (texture2D(cogl_sampler, SAFE(uvR + off1)).r +
         texture2D(cogl_sampler, SAFE(uvR + off2)).r +
         texture2D(cogl_sampler, SAFE(uvR + off3)).r +
         texture2D(cogl_sampler, SAFE(uvR + off4)).r) * 0.25,

        (texture2D(cogl_sampler, SAFE(uvG + off1)).g +
         texture2D(cogl_sampler, SAFE(uvG + off2)).g +
         texture2D(cogl_sampler, SAFE(uvG + off3)).g +
         texture2D(cogl_sampler, SAFE(uvG + off4)).g) * 0.25,

        (texture2D(cogl_sampler, SAFE(uvB + off1)).b +
         texture2D(cogl_sampler, SAFE(uvB + off2)).b +
         texture2D(cogl_sampler, SAFE(uvB + off3)).b +
         texture2D(cogl_sampler, SAFE(uvB + off4)).b) * 0.25
    );

    // Gently boost the backdrop so colors read through the glass without
    // drifting into candy saturation.
    vec3 refracted = refractedRgb;
    float luma = dot(refracted, vec3(0.2126, 0.7152, 0.0722));
    refracted = clamp(mix(vec3(luma), refracted, saturation), 0.0, 1.0);

    vec3 tintColor = mix(vec3(1.0), vec3(0.10, 0.10, 0.11), dark_tint);
    float tintStrength = mix(0.15, 0.45, dark_tint);
    vec3 insideBaseColor = mix(refracted, tintColor, tintStrength);
    // Thin hairline outline, replacing the bevel/rim lighting. A crisp,
    // semi-transparent dark stroke tracks the Lisse silhouette just inside the
    // edge, so the dock reads as a clean outlined panel rather than a lit bevel.
    // The interior refraction + tint above is left untouched. The line is
    // centered slightly inside the boundary so it stays fully opaque rather than
    // being eaten by the antialiased alpha falloff at dMask = 0.
    // No solid core (outlineHalf = 0): the line is a triangular falloff peaking
    // on one contour, so it stays a hairline. The feather is the antialiasing
    // span; because dMask is a true unit-gradient distance field, ~1.25 SDF
    // units is ~1.25px of real AA, enough to smooth the curve without a
    // screen-space derivative (fwidth), which this Cogl context may not support.
    float outlineCenter = 1.0;       // px inside the silhouette edge
    float outlineHalf = 0.0;         // no solid core: a hairline
    float outlineFeather = 1.25;     // antialiasing span in px
    vec3 outlineColor = vec3(0.5);   // mid-gray hairline
    float outlineOpacity = 0.5;
    float dEdge = abs(-dMask - outlineCenter);
    float outline = 1.0 - smoothstep(outlineHalf, outlineHalf + outlineFeather, dEdge);

    vec3 color = mix(insideBaseColor, outlineColor, outline * outlineOpacity);
    color *= insideMask;

    cogl_color_out = vec4(color, insideMask) * cogl_color_in;
}
