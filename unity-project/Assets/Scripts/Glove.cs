// =====================================================================
// Glove — sits on the outer tip of each forearm and is the ONLY part of
// the player rig that can trigger a grab. Forearm/upper-arm/elbow contacts
// are intentionally ignored.
// =====================================================================
using UnityEngine;

public class Glove : MonoBehaviour
{
    [System.NonSerialized] public Arm arm;
    [System.NonSerialized] public GameManager game;

    void OnCollisionStay2D(Collision2D collision) { TryGrab(collision); }
    void OnCollisionEnter2D(Collision2D collision) { TryGrab(collision); }

    void TryGrab(Collision2D collision)
    {
        if (arm == null || game == null) return;
        if (!arm.grabIntent || arm.grabbed) return;
        var other = collision.rigidbody;
        // Static platforms have no rigidbody — get the collider's parent instead.
        if (other == null) other = collision.collider.attachedRigidbody;
        if (other == null)
        {
            // Static collider — use a tiny stand-in: get the collider's GameObject's Rigidbody2D.
            other = collision.collider.GetComponent<Rigidbody2D>();
        }
        if (other == null)
        {
            // Truly static (no Rigidbody2D at all). Add a static body on the fly so we can hinge to it.
            other = collision.collider.gameObject.GetComponent<Rigidbody2D>();
            if (other == null)
            {
                other = collision.collider.gameObject.AddComponent<Rigidbody2D>();
                other.bodyType = RigidbodyType2D.Static;
            }
        }
        if (!IsGrabbable(collision.collider)) return;

        Vector2 pt = transform.position;
        if (collision.contactCount > 0) pt = collision.GetContact(0).point;
        game.Grab(arm, other, pt);
    }

    public void TryImmediateGrab(Arm a)
    {
        var hits = Physics2D.OverlapCircleAll(transform.position, GetComponent<CircleCollider2D>().radius * transform.lossyScale.x);
        foreach (var h in hits)
        {
            if (h.gameObject == gameObject) continue;
            if (!IsGrabbable(h)) continue;
            var rb = h.attachedRigidbody;
            if (rb == null)
            {
                rb = h.gameObject.GetComponent<Rigidbody2D>();
                if (rb == null) { rb = h.gameObject.AddComponent<Rigidbody2D>(); rb.bodyType = RigidbodyType2D.Static; }
            }
            game.Grab(a, rb, transform.position);
            return;
        }
    }

    bool IsGrabbable(Collider2D c)
    {
        var go = c.gameObject;
        // Platforms or drawings or their child segments. We tag by name prefix here for simplicity.
        if (go.name.StartsWith("Platform") || go.name == "Drawing" || go.name.StartsWith("Seg")
            || (go.transform.parent != null && go.transform.parent.name == "Drawing"))
            return true;
        return false;
    }
}
