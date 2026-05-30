// Frosted glass: squircle mask + tint over pre-blurred clone texture.
uniform sampler2D cogl_sampler;

uniform float resolution_x;
uniform float resolution_y;
uniform float corner_radius;
uniform float edge_smoothing;
uniform float tint_strength;
uniform float tint_r;
uniform float tint_g;
uniform float tint_b;
uniform float padding;
uniform float isDock;
uniform float squircle_exponent;

float sdSquircle(vec2 p, vec2 b, float r, float n) {
    n = max(n, 2.01);
    r = min(r, min(b.x, b.y));
    p = abs(p);
    vec2 q = p - b + r;

    if (q.x > 0.0 && q.y > 0.0) {
        vec2 c = q / max(r, 1.0);
        float k = pow(pow(c.x, n) + pow(c.y, n), 1.0 / n);
        return (k - 1.0) * r;
    }

    return min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0))) - r;
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

    float d = sdSquircle(local_pos, box_size, corner_radius, squircle_exponent);
    float insideMask = smoothstep(edgeFeather, -edgeFeather, d);

    vec3 blurred = texture2D(cogl_sampler, uv).rgb;
    vec3 tintColor = vec3(tint_r, tint_g, tint_b);
    vec3 color = mix(blurred, tintColor, tint_strength);

    cogl_color_out = vec4(color * insideMask, insideMask) * cogl_color_in;
}
