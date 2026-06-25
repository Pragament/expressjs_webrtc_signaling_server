import webpush from 'npm:web-push'

console.log("Webpush imported successfully:", typeof webpush.setVapidDetails);

try {
    webpush.setVapidDetails(
      'mailto:admin@example.com',
      'BDlvn1pa0AAv0Ul-e5xr-PvoWxExA8q3rBx90gktFfEWxFzvDy1-nC-wZqK-pXGLiZMX86WleU3rLIF9kTwn694',
      'test_private_key'
    );
    console.log("Vapid details set successfully");
} catch (e) {
    console.error("Error setting vapid details:", e);
}
