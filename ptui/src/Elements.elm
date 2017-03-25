module Elements exposing (..)

-- A module of higher level abstractions for UI elements.

import Html exposing (..)
import Html.Attributes exposing (..)
import Css as S

stdStyle = []

hbox : List (Html a) -> Html a
hbox els = habox stdStyle els

habox : List (Attribute a) -> List (Html a) -> Html a
habox attrs els = sdiv (attrs ++ [style [("display", "flex")]]) els

vbox : List (Html a) -> Html a
vbox els = vabox stdStyle els

vabox : List (Attribute a) -> List (Html a) -> Html a
vabox attrs els = sdiv (attrs ++ [style [("display", "flex"), ("flex-direction", "column")]]) els

datext a t = sdiv a [text t]

dtext t = sdiv [] [text t]

abspos left_ top_ = [S.position S.fixed, S.left left_, S.top top_]
overlay left_ top_ extra =
  sdiv <| stdStyle ++ [s <| (abspos left_ top_) ++ extra ++ [plainBorder, S.backgroundColor (S.rgb 255 255 255)]]

overlayRight right_ top_ extra = 
  sdiv <| stdStyle ++ [s <| [S.position S.fixed, S.right right_, S.top top_] ++ extra ++ [plainBorder, S.backgroundColor (S.rgb 255 255 255)]]

plainBorder = S.border3 (S.px 1) S.solid (S.rgb 0 0 0)

button : List (Attribute msg) -> List (Html msg) -> Html msg
button attrs contents =
  Html.button (stdStyle ++ [s [S.margin (S.px 0)]] ++ attrs) contents

sqButton : Float -> List (Attribute msg) -> List (Html msg) -> Html msg
sqButton size attrs content =
  button ([s [S.height (S.px size), S.width (S.px size)]] ++ attrs) content

s : List S.Mixin -> Attribute msg
s = S.asPairs >> Html.Attributes.style

hline = hr (stdStyle ++ [s [S.width (S.pct 100)]]) []

sdiv attrs body = div (attrs ++ stdStyle) body

clickable = s [S.cursor S.pointer]

noUserSelect =
  List.map (\name -> S.property name "none") ["-webkit-user-select", "-khtml-user-select", "-moz-user-select", "-ms-user-select", "user-select"]

icon attrs name = i (attrs ++ [class "material-icons", s noUserSelect]) [text name]

gear = icon [] "settings"
gearBox = icon [] "settings_applications"
threeDots = icon [] "more_horiz"

clickableIcon attrs name = icon (attrs ++ [clickable]) name
