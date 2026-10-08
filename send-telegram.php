<?php
header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json; charset=UTF-8");

// Sizning tokeningiz va Chat ID raqamingiz joylandi
$botToken = "8831562668:AAEM5PvV0QY6dJl12w0pAmR27u-z_v4EN9w"; 
$chatId = "8781391205";       

$data = json_decode(file_get_contents("php://input"), true);

$name = isset($data['name']) ? trim($data['name']) : '';
$message = isset($data['message']) ? trim($data['message']) : '';

if (empty($name) || empty($message)) {
    echo json_encode(["success" => false, "error" => "Ma'lumotlar to'liq emas."]);
    exit;
}

date_default_timezone_set('Asia/Tashkent');
$dateTime = date('d.m.Y H:i:s');

$safeName = htmlspecialchars($name, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
$safeMessage = htmlspecialchars($message, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');

$text = "✨ <b>Yangi xabar • Ilyos Web</b> ✨\n";
$text .= "━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n";
$text .= "👤 <b>Ismi:</b> " . $safeName . "\n";
$text .= "📩 <b>Xabar:</b>\n<pre>" . $safeMessage . "</pre>\n";
$text .= "🕒 <b>Vaqti:</b> " . $dateTime . "\n";
$text .= "━━━━━━━━━━━━━━━━━━━━━━━━━━━━";

$website = "https://api.telegram.org/bot" . $botToken;
$params = [
    'chat_id' => $chatId,
    'text' => $text,
    'parse_mode' => 'HTML'
];

$ch = curl_init($website . "/sendMessage");
curl_setopt($ch, CURLOPT_HEADER, false);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
curl_setopt($ch, CURLOPT_POST, 1);
curl_setopt($ch, CURLOPT_POSTFIELDS, ($params));
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER_RELATED, false); // agar xato bersa cURL sozlamasi
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
$result = curl_exec($ch);
curl_close($ch);

$result_arr = json_decode($result, true);

if (isset($result_arr['ok']) && $result_arr['ok'] == true) {
    echo json_encode(["success" => true]);
} else {
    echo json_encode(["success" => false, "error" => "Telegramga yuborishda xatolik yuz berdi."]);
}
?>