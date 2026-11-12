using UnityEngine;

namespace PartRotatorExtension.PartLoader
{
    /// <summary>
    /// Keeps a reentry shell where its mesh is. <c>RocketPartCtrl.InstantiateReentry()</c> parents
    /// the instance to the "reentry" child of the part and sets
    /// <c>localPosition = part.bounds.center + partSchema.reentryOffset</c>; <c>part.bounds</c> is
    /// the bounds of the baked *volume*, not of the mesh, and the game adds that value even though
    /// the shell mesh is authored in the space of the part. The stock shells are exact copies of
    /// their part mesh and the stock models are centered on their own origin, so for them the move
    /// is ~0 and never shows; a mod part can have any origin, and the shell would end up shifted
    /// along the part (inside the hull, or standing off it).
    ///
    /// The component cancels the move without knowing the game's value: whatever the game sets is
    /// put back to zero whenever the shell is active (the shell is deactivated right after the game
    /// positions it and activated when the part starts to glow).
    /// </summary>
    internal sealed class ReentryAnchor : MonoBehaviour
    {
        private bool reported;
        private Vector3 gameOffset;

        private void OnEnable()
        {
            Snap();
        }

        /// <summary>
        /// The game may position the instance before or after it is activated, so the correction
        /// also runs every frame while the shell is visible - the value is set once, the check is
        /// a comparison against zero.
        /// </summary>
        private void LateUpdate()
        {
            Snap();
            Report();
        }

        private void Snap()
        {
            if (transform.localPosition != Vector3.zero ||
                transform.localRotation != Quaternion.identity)
            {
                gameOffset = transform.localPosition;
                transform.localPosition = Vector3.zero;
                transform.localRotation = Quaternion.identity;
            }
        }

        /// <summary>
        /// Writes the placement of the game and the actual centers of the shell and the model of
        /// the part into the log once, so a wrong shell can be diagnosed from the log alone.
        /// </summary>
        private void Report()
        {
            if (reported)
            {
                return;
            }

            reported = true;

            Transform part = transform.parent != null ? transform.parent.parent : null;
            Transform model = part != null ? part.Find("model") : null;
            var shellRenderer = GetComponent<MeshRenderer>();
            MeshRenderer modelRenderer = model != null ? model.GetComponentInChildren<MeshRenderer>(true) : null;

            string line = "reentry shell of " + name + ": game offset " + JsonHelp.Invariant(gameOffset);
            if (shellRenderer != null)
            {
                line += ", shell center " + JsonHelp.Invariant(shellRenderer.bounds.center) +
                        " size " + JsonHelp.Invariant(shellRenderer.bounds.size);
            }

            if (modelRenderer != null)
            {
                line += ", model center " + JsonHelp.Invariant(modelRenderer.bounds.center) +
                        " size " + JsonHelp.Invariant(modelRenderer.bounds.size);
            }

            Diagnostics.Info(line);
        }
    }
}
