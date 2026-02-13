using UnityEngine;

namespace RSExtension
{
    public class ModMenu : MonoBehaviour
    {
        private Rect windowRect = new Rect(Screen.width / 2, Screen.height / 2, 200, 500);

        public Vector3 partRotation;
        public bool tryAgain = false;

        public void OnGUI()
        {
            windowRect = GUILayout.Window(1, windowRect, WindowContent, "Part rotator menu");
        }

        public void Update()
        {
        }

        void WindowContent(int windowID)
        {
            GUI.DragWindow(new Rect(0, 0, windowRect.width, 20));
            GUILayout.Label("Part: ");
            if(GUILayout.Button("Try again"))
            {
                tryAgain =true;
            }
        }
    }
}
