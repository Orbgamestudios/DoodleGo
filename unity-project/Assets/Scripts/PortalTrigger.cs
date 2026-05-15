using UnityEngine;

public class PortalTrigger : MonoBehaviour
{
    [System.NonSerialized] public GameManager game;

    void OnTriggerEnter2D(Collider2D other)
    {
        // Win if the head or any glove enters the portal.
        if (other.gameObject.name == "Head" || other.gameObject.name.StartsWith("Glove_"))
        {
            if (game != null) game.OnReachedPortal();
        }
    }
}
